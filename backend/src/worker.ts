/**
 * Campaign worker
 * ---------------
 * Dequeues jobs from Redis, paces sends via Protection Engine,
 * updates Postgres + publishes progress over Redis (→ WebSocket).
 *
 * Delivery channel:
 * - extension / web clients pull `message.pending` via API or receive
 *   `dispatch_message` events and send on WhatsApp Web, then ACK back.
 * - This worker orchestrates order, delay, quotas, and status — it does
 *   not hold Puppeteer by default (extension path is primary for WA Web).
 */

import { prisma } from './lib/prisma.js';
import { dequeueJob, publishEvent } from './lib/redis.js';
import { nextDelayMs } from './lib/protection-engine.js';
import { recordSends } from './services/usage.service.js';

type Job = { type: 'run_campaign'; campaignId: string; userId: string };

let running = true;

async function processCampaign(job: Job) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: job.campaignId, userId: job.userId },
  });
  if (!campaign) return;
  if (campaign.status === 'blocked' || campaign.status === 'cancelled') return;

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: 'running', startedAt: new Date() },
  });
  await publishEvent(`user:${job.userId}`, {
    type: 'campaign_running',
    campaignId: campaign.id,
  });

  const messages = await prisma.message.findMany({
    where: { campaignId: campaign.id, status: { in: ['queued', 'pending'] } },
    orderBy: { createdAt: 'asc' },
  });

  let sent = 0;
  let failed = 0;
  let consecutiveSuccesses = 0;
  let consecutiveFailures = 0;
  let rateLimitHits = 0;

  for (let i = 0; i < messages.length; i++) {
    if (!running) break;
    const msg = messages[i];

    // Re-check cancel
    const fresh = await prisma.campaign.findUnique({ where: { id: campaign.id } });
    if (!fresh || fresh.status === 'cancelled' || fresh.status === 'paused') break;

    await prisma.message.update({
      where: { id: msg.id },
      data: { status: 'sending' },
    });

    // Dispatch to clients (extension / dashboard) to actually send on WA Web
    await publishEvent(`user:${job.userId}`, {
      type: 'dispatch_message',
      campaignId: campaign.id,
      messageId: msg.id,
      phone: msg.phone,
      body: msg.body,
      index: i,
      total: messages.length,
    });

    // Optimistic "sent" for orchestration; real ACK can PATCH later
    // Extension should call POST /api/messages/:id/ack when WA confirms
    await prisma.message.update({
      where: { id: msg.id },
      data: { status: 'sent', sentAt: new Date() },
    });
    sent++;
    consecutiveSuccesses++;
    consecutiveFailures = 0;

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { sentCount: { increment: 1 } },
    });

    await publishEvent(`user:${job.userId}`, {
      type: 'message_progress',
      campaignId: campaign.id,
      messageId: msg.id,
      phone: msg.phone,
      status: 'sent',
      sent,
      failed,
      total: messages.length,
    });

    if (i < messages.length - 1) {
      const batchSize = Math.max(1, campaign.batchSize);
      if (sent % batchSize === 0 && campaign.cooldownSeconds > 0) {
        await sleep(campaign.cooldownSeconds * 1000);
      } else {
        const delay = nextDelayMs({
          baseDelayMs: campaign.delayMs,
          jitterEnabled: campaign.jitterEnabled,
          consecutiveSuccesses,
          consecutiveFailures,
          rateLimitHitsSession: rateLimitHits,
          progressRatio: (i + 1) / messages.length,
        });
        await sleep(delay);
      }
    }
  }

  await recordSends(job.userId, sent, failed, 1);
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: 'completed',
      completedAt: new Date(),
      sentCount: sent,
      failedCount: failed,
    },
  });
  await publishEvent(`user:${job.userId}`, {
    type: 'campaign_completed',
    campaignId: campaign.id,
    sent,
    failed,
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loop() {
  console.log('[worker] Campaign worker started (enterprise protection pacing)');
  while (running) {
    try {
      const job = await dequeueJob<Job>();
      if (!job) continue;
      if (job.type === 'run_campaign') {
        console.log('[worker] run_campaign', job.campaignId);
        await processCampaign(job);
      }
    } catch (err) {
      console.error('[worker]', err);
      await sleep(3000);
    }
  }
}

process.on('SIGINT', () => {
  running = false;
});
process.on('SIGTERM', () => {
  running = false;
});

loop();
