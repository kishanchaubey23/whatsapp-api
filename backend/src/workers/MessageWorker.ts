/**
 * MessageWorker — BullMQ consumer for verify + send blasts
 * --------------------------------------------------------
 * - GlobalPhoneRegistry read-through via PhoneVerificationService
 * - Account-specific blocked state via WhatsAppAccountPhoneStateService
 * - Anti-ban sleep, kill-switch, protection risk (unchanged architecture)
 */

import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { wwbClientFactory } from '../services/WWBClientFactory.js';
import { queueService, type BlastJobPayload } from '../services/QueueService.js';
import { publishEvent } from '../lib/redis.js';
import { classifyWaError } from '../lib/wa-error-classifier.js';
import {
  applyRuntimeRiskEvent,
  riskEventFromCategory,
  type RuntimeRiskState,
} from '../lib/protection-engine.js';
import { phoneVerificationService } from '../services/PhoneVerificationService.js';
import { globalPhoneRegistryService } from '../services/GlobalPhoneRegistryService.js';
import { waAccountPhoneStateService } from '../services/WhatsAppAccountPhoneStateService.js';
import {
  onSendSuccess,
  onSendOrVerifyFailure,
} from '../services/SendOutcomeRegistryBridge.js';
import { normalizePhone, toWhatsAppChatId } from '../lib/phone.js';

function antiBanSleepMs(): number {
  const min = Math.min(config.antiBanSleepMinMs, config.antiBanSleepMaxMs);
  const max = Math.max(config.antiBanSleepMinMs, config.antiBanSleepMaxMs);
  return Math.floor(min + Math.random() * (max - min + 1));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const sessionRisk = new Map<string, RuntimeRiskState>();
const PROTOCOL_KILL_THRESHOLD = 3;

async function bumpBatch(
  batchId: string,
  fields: {
    processed?: number;
    verified?: number;
    sent?: number;
    failed?: number;
    skipped?: number;
    status?: 'processing' | 'paused' | 'failed' | 'cancelled';
    lastError?: string;
  },
) {
  await prisma.blastBatch.update({
    where: { id: batchId },
    data: {
      ...(fields.processed ? { processedCount: { increment: fields.processed } } : {}),
      ...(fields.verified ? { verifiedCount: { increment: fields.verified } } : {}),
      ...(fields.sent ? { sentCount: { increment: fields.sent } } : {}),
      ...(fields.failed ? { failedCount: { increment: fields.failed } } : {}),
      ...(fields.skipped ? { skippedCount: { increment: fields.skipped } } : {}),
      status: fields.status ?? 'processing',
      ...(fields.lastError !== undefined ? { lastError: fields.lastError } : {}),
      startedAt: new Date(),
    },
  });
}

async function finalizeBatchIfDone(batchId: string) {
  const batch = await prisma.blastBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.status === 'cancelled' || batch.status === 'paused') return;

  if (batch.processedCount >= batch.totalNumbers) {
    const status =
      batch.failedCount === 0
        ? 'completed'
        : batch.sentCount + batch.verifiedCount > 0
          ? 'partial'
          : 'failed';
    await prisma.blastBatch.update({
      where: { id: batchId },
      data: { status, completedAt: new Date() },
    });
  }
}

async function markContactBlocked(userId: string, phone: string) {
  const digits = normalizePhone(phone);
  if (!digits) return;
  await prisma.contact
    .updateMany({
      where: { userId, phone: digits },
      data: { waStatus: 'blocked_or_unavailable' },
    })
    .catch(() => undefined);
}

async function triggerSessionKillSwitch(params: {
  userId: string;
  whatsappAccountId: string;
  batchId: string;
  reason: string;
  banned: boolean;
  risk: RuntimeRiskState;
  job: Job<BlastJobPayload>;
}) {
  const { userId, whatsappAccountId, batchId, reason, banned, risk, job } = params;
  const accountStatus = banned ? 'banned' : 'session_terminated';

  await prisma.whatsAppAccount.update({
    where: { id: whatsappAccountId },
    data: {
      status: accountStatus,
      lastError: reason.slice(0, 2000),
      riskScore: risk.score,
      lastRiskEvent: risk.lastEvent ?? 'session_dead',
      consecutiveProtocolFailures: risk.consecutiveProtocolFailures,
    },
  });

  await prisma.blastBatch.update({
    where: { id: batchId },
    data: {
      status: 'paused',
      lastError: `SESSION_TERMINATED: ${reason}`.slice(0, 2000),
      completedAt: new Date(),
    },
  });

  try {
    await queueService.abortBatchJobs(batchId);
    await prisma.blastBatch.update({
      where: { id: batchId },
      data: {
        status: 'paused',
        lastError: `SESSION_TERMINATED: ${reason}`.slice(0, 2000),
        completedAt: new Date(),
      },
    });
  } catch (err) {
    console.warn('[MessageWorker] abortBatchJobs during kill-switch failed', err);
  }

  await wwbClientFactory.destroy(whatsappAccountId, false).catch(() => undefined);

  await job.updateProgress({
    emergency: true,
    killSwitch: true,
    accountStatus,
    riskScore: risk.score,
    riskTier: risk.tier,
    reason,
  });

  await publishEvent(`user:${userId}`, {
    type: 'critical_session_alert',
    severity: 'critical',
    title: banned ? 'WhatsApp account banned/suspended' : 'WhatsApp session terminated',
    message:
      'Your bulk campaign was paused automatically. Re-link the Business account before continuing.',
    whatsappAccountId,
    batchId,
    accountStatus,
    riskScore: risk.score,
    riskTier: risk.tier,
    reason: reason.slice(0, 500),
  });
}

async function persistAccountRisk(whatsappAccountId: string, risk: RuntimeRiskState) {
  await prisma.whatsAppAccount
    .update({
      where: { id: whatsappAccountId },
      data: {
        riskScore: risk.score,
        lastRiskEvent: risk.lastEvent,
        consecutiveProtocolFailures: risk.consecutiveProtocolFailures,
      },
    })
    .catch(() => undefined);
}

export class MessageWorker {
  private worker: Worker<BlastJobPayload> | null = null;

  start(): Worker<BlastJobPayload> {
    if (this.worker) return this.worker;

    const connection = config.redisConnection as ConnectionOptions;

    this.worker = new Worker<BlastJobPayload>(
      config.queueName,
      async (job) => this.processJob(job),
      {
        connection,
        concurrency: config.workerConcurrency,
        lockDuration: 600_000,
        stalledInterval: 120_000,
      },
    );

    this.worker.on('completed', (job) => {
      console.log(`[MessageWorker] completed job=${job.id} batch=${job.data.batchId}`);
    });
    this.worker.on('failed', (job, err) => {
      console.error(`[MessageWorker] failed job=${job?.id}`, err.message);
    });
    this.worker.on('error', (err) => {
      console.error('[MessageWorker] worker error:', {
        name: err.name,
        message: err.message,
        stack: err.stack,
        code: (err as NodeJS.ErrnoException).code,
      });
    });

    console.log(
      `[MessageWorker] queue=${config.queueName} concurrency=${config.workerConcurrency} registry=on`,
    );
    return this.worker;
  }

  async processJob(job: Job<BlastJobPayload>): Promise<{
    processed: number;
    verified: number;
    sent: number;
    failed: number;
    blocked: number;
    cacheHits?: number;
    killed?: boolean;
  }> {
    const { batchId, userId, whatsappAccountId, kind, messageBody, phones, chunkIndex, chunkTotal } =
      job.data;

    const batch = await prisma.blastBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    if (batch.status === 'cancelled' || batch.status === 'paused') {
      return { processed: 0, verified: 0, sent: 0, failed: 0, blocked: 0 };
    }

    const account = await prisma.whatsAppAccount.findUnique({ where: { id: whatsappAccountId } });
    if (
      account &&
      (account.status === 'banned' ||
        account.status === 'session_terminated' ||
        account.status === 'disconnected' ||
        account.status === 'error')
    ) {
      await prisma.blastBatch.update({
        where: { id: batchId },
        data: {
          status: 'paused',
          lastError: `Account not operable (status=${account.status})`,
          completedAt: new Date(),
        },
      });
      return { processed: 0, verified: 0, sent: 0, failed: 0, blocked: 0, killed: true };
    }

    await prisma.blastBatch.update({
      where: { id: batchId },
      data: { status: 'processing', startedAt: batch.startedAt ?? new Date() },
    });

    let managed;
    try {
      managed = await wwbClientFactory.getOrCreate(whatsappAccountId);
    } catch (err) {
      const classified = classifyWaError(err);
      if (classified.isSessionFatal) {
        const risk = applyRuntimeRiskEvent(
          sessionRisk.get(whatsappAccountId),
          riskEventFromCategory(classified.category, classified.message),
          { consecutiveProtocolThreshold: PROTOCOL_KILL_THRESHOLD },
        );
        risk.consecutiveProtocolFailures = PROTOCOL_KILL_THRESHOLD;
        risk.killSwitch = true;
        sessionRisk.set(whatsappAccountId, risk);
        await triggerSessionKillSwitch({
          userId,
          whatsappAccountId,
          batchId,
          reason: classified.message,
          banned: /banned|suspended/i.test(classified.message),
          risk,
          job,
        });
        return { processed: 0, verified: 0, sent: 0, failed: 0, blocked: 0, killed: true };
      }
      throw err;
    }

    if (managed.status !== 'ready') {
      throw new Error(`WhatsApp account ${whatsappAccountId} not ready (${managed.status})`);
    }
    const client = managed.client;

    let processed = 0;
    let verified = 0;
    let sent = 0;
    let failed = 0;
    let blocked = 0;
    let cacheHits = 0;

    await publishEvent(`user:${userId}`, {
      type: 'blast_chunk_started',
      batchId,
      chunkIndex,
      chunkTotal,
      size: phones.length,
    });

    for (let i = 0; i < phones.length; i++) {
      const live = await prisma.blastBatch.findUnique({ where: { id: batchId } });
      if (!live || live.status === 'cancelled' || live.status === 'paused') break;
      if (sessionRisk.get(whatsappAccountId)?.killSwitch) break;

      const phoneRaw = phones[i];
      const phone = normalizePhone(phoneRaw);
      if (!phone) {
        failed += 1;
        processed += 1;
        await bumpBatch(batchId, { processed: 1, failed: 1 });
        continue;
      }

      // Account-specific: skip send if this account already knows blocked
      if (kind === 'send' || kind === 'verify_and_send') {
        const rel = await waAccountPhoneStateService.get(whatsappAccountId, phone);
        if (rel?.status === 'blocked_or_unavailable') {
          blocked += 1;
          processed += 1;
          await markContactBlocked(userId, phone);
          await bumpBatch(batchId, { processed: 1, failed: 1, skipped: 1 });
          continue;
        }
      }

      try {
        let isOnWa = true;
        let verifySource: string | undefined;

        if (kind === 'verify' || kind === 'verify_and_send') {
          const result = await phoneVerificationService.verifyWithClient({
            phone,
            client,
            userId,
            sourceAccountId: whatsappAccountId,
          });
          if (!result) throw new Error(`Invalid phone ${phoneRaw}`);

          isOnWa = result.onWhatsApp;
          verifySource = result.source;
          if (result.source === 'global_cache') cacheHits += 1;
          if (isOnWa) verified += 1;

          await waAccountPhoneStateService.upsert({
            whatsappAccountId,
            phone,
            status: isOnWa ? 'available' : 'not_registered',
            success: isOnWa,
            failureReason: isOnWa ? null : 'not_on_whatsapp',
          });

          const okRisk = applyRuntimeRiskEvent(sessionRisk.get(whatsappAccountId), 'verify_success');
          sessionRisk.set(whatsappAccountId, okRisk);
        }

        if ((kind === 'send' || kind === 'verify_and_send') && messageBody) {
          if (kind === 'verify_and_send' && !isOnWa) {
            await bumpBatch(batchId, { processed: 1, skipped: 1 });
            processed += 1;
          } else {
            // Optional: skip live if global says not_on_whatsapp fresh (send-only path)
            if (kind === 'send') {
              const fresh = await globalPhoneRegistryService.getFresh(phone);
              if (fresh?.isFresh && fresh.status === 'not_on_whatsapp') {
                await bumpBatch(batchId, { processed: 1, skipped: 1, failed: 1 });
                processed += 1;
                failed += 1;
                await prisma.contact
                  .updateMany({ where: { userId, phone }, data: { waStatus: 'invalid' } })
                  .catch(() => undefined);
                // still sleep below
              } else {
                await this.doSend({
                  client,
                  phone,
                  messageBody,
                  userId,
                  batchId,
                  whatsappAccountId,
                });
                sent += 1;
                processed += 1;
                await bumpBatch(batchId, { processed: 1, sent: 1 });
                const okRisk = applyRuntimeRiskEvent(
                  sessionRisk.get(whatsappAccountId),
                  'send_success',
                );
                sessionRisk.set(whatsappAccountId, okRisk);
                await persistAccountRisk(whatsappAccountId, okRisk);
              }
            } else {
              await this.doSend({
                client,
                phone,
                messageBody,
                userId,
                batchId,
                whatsappAccountId,
              });
              sent += 1;
              processed += 1;
              await bumpBatch(batchId, {
                processed: 1,
                sent: 1,
                verified: isOnWa ? 1 : 0,
              });
              const okRisk = applyRuntimeRiskEvent(
                sessionRisk.get(whatsappAccountId),
                'send_success',
              );
              sessionRisk.set(whatsappAccountId, okRisk);
              await persistAccountRisk(whatsappAccountId, okRisk);
            }
          }
        } else if (kind === 'verify') {
          await bumpBatch(batchId, {
            processed: 1,
            verified: isOnWa ? 1 : 0,
            failed: isOnWa ? 0 : 1,
          });
          processed += 1;
          if (!isOnWa) failed += 1;
        }

        await job.updateProgress({
          chunkIndex,
          index: i + 1,
          total: phones.length,
          phone,
          verified,
          sent,
          failed,
          blocked,
          cacheHits,
          verifySource,
          riskScore: sessionRisk.get(whatsappAccountId)?.score ?? 0,
        });

        await publishEvent(`user:${userId}`, {
          type: 'blast_number_done',
          batchId,
          phone,
          index: i + 1,
          chunkIndex,
          verifySource,
        });
      } catch (err) {
        const tagged = (err as { __waCategory?: string })?.__waCategory;
        const classified = tagged
          ? {
              ...classifyWaError(err),
              category: tagged as ReturnType<typeof classifyWaError>['category'],
            }
          : classifyWaError(err);

        if (classified.category === 'target_blocked') {
          blocked += 1;
          processed += 1;
          failed += 1;
          await markContactBlocked(userId, phone);
          await bumpBatch(batchId, { processed: 1, failed: 1, skipped: 1 });

          // Account-specific only — NEVER poison GlobalPhoneRegistry
          await waAccountPhoneStateService.upsert({
            whatsappAccountId,
            phone,
            status: 'blocked_or_unavailable',
            success: false,
            failureReason: classified.message.slice(0, 500),
          });

          const risk = applyRuntimeRiskEvent(sessionRisk.get(whatsappAccountId), 'target_blocked');
          sessionRisk.set(whatsappAccountId, risk);
          await persistAccountRisk(whatsappAccountId, risk);

          await publishEvent(`user:${userId}`, {
            type: 'blast_contact_blocked',
            batchId,
            phone,
            status: 'blocked_or_unavailable',
            riskScore: risk.score,
          });
        } else if (classified.isSessionFatal || classified.category === 'session_dead') {
          failed += 1;
          processed += 1;
          await bumpBatch(batchId, { processed: 1, failed: 1 });

          const riskEvent = riskEventFromCategory(classified.category, classified.message);
          const risk = applyRuntimeRiskEvent(sessionRisk.get(whatsappAccountId), riskEvent, {
            consecutiveProtocolThreshold: PROTOCOL_KILL_THRESHOLD,
          });
          sessionRisk.set(whatsappAccountId, risk);
          await persistAccountRisk(whatsappAccountId, risk);

          if (risk.killSwitch || risk.consecutiveProtocolFailures >= PROTOCOL_KILL_THRESHOLD) {
            await triggerSessionKillSwitch({
              userId,
              whatsappAccountId,
              batchId,
              reason: classified.message,
              banned: riskEvent === 'session_banned',
              risk,
              job,
            });
            break;
          }
          await sleep(antiBanSleepMs() * 2);
        } else {
          failed += 1;
          processed += 1;
          await bumpBatch(batchId, { processed: 1, failed: 1 });

          // Global registration evidence only when classifier says not_registered
          if (classified.category === 'not_registered') {
            await globalPhoneRegistryService.markNotOnWhatsApp(phone, whatsappAccountId);
            await prisma.contact
              .updateMany({ where: { userId, phone }, data: { waStatus: 'invalid' } })
              .catch(() => undefined);
            await waAccountPhoneStateService.upsert({
              whatsappAccountId,
              phone,
              status: 'not_registered',
              success: false,
              failureReason: classified.message.slice(0, 500),
            });
          } else {
            await waAccountPhoneStateService.upsert({
              whatsappAccountId,
              phone,
              status: 'send_failed',
              success: false,
              failureReason: classified.message.slice(0, 500),
            });
          }

          const risk = applyRuntimeRiskEvent(
            sessionRisk.get(whatsappAccountId),
            riskEventFromCategory(classified.category, classified.message),
          );
          sessionRisk.set(whatsappAccountId, risk);
          await persistAccountRisk(whatsappAccountId, risk);

          if (classified.category === 'rate_limited') {
            await sleep(antiBanSleepMs() * 2);
          }
        }
      }

      if (i < phones.length - 1 && !sessionRisk.get(whatsappAccountId)?.killSwitch) {
        const delay = antiBanSleepMs();
        await sleep(delay);
      }
    }

    await finalizeBatchIfDone(batchId);

    const killed = Boolean(sessionRisk.get(whatsappAccountId)?.killSwitch);
    await publishEvent(`user:${userId}`, {
      type: 'blast_chunk_completed',
      batchId,
      chunkIndex,
      processed,
      verified,
      sent,
      failed,
      blocked,
      cacheHits,
      killed,
    });

    return { processed, verified, sent, failed, blocked, cacheHits, killed };
  }

  private async doSend(params: {
    client: import('whatsapp-web.js').Client;
    phone: string;
    messageBody: string;
    userId: string;
    batchId: string;
    whatsappAccountId: string;
  }) {
    const { client, phone, messageBody, userId, batchId, whatsappAccountId } = params;
    const chatId = toWhatsAppChatId(phone);

    try {
      const result = await client.sendMessage(chatId, messageBody);
      const externalId = result?.id?.id ?? null;

      // Phase 2: successful send → global on_whatsapp + account state (via bridge)
      await onSendSuccess({ phone, userId, whatsappAccountId });

      await prisma.message
        .create({
          data: {
            userId,
            campaignId: (await this.ensureShadowCampaign(userId, batchId, messageBody, whatsappAccountId))
              .id,
            phone,
            body: messageBody,
            status: 'sent',
            externalId,
            sentAt: new Date(),
          },
        })
        .catch(() => undefined);
    } catch (sendErr) {
      // Phase 2: classify → global only for registration evidence; blocked stays account-level
      await onSendOrVerifyFailure({ phone, userId, whatsappAccountId }, sendErr);

      const c = classifyWaError(sendErr);
      if (c.category === 'target_blocked') {
        throw Object.assign(sendErr instanceof Error ? sendErr : new Error(c.message), {
          __waCategory: 'target_blocked',
        });
      }
      if (c.isSessionFatal) {
        throw Object.assign(sendErr instanceof Error ? sendErr : new Error(c.message), {
          __waCategory: 'session_dead',
        });
      }
      if (c.category === 'not_registered') {
        throw Object.assign(sendErr instanceof Error ? sendErr : new Error(c.message), {
          __waCategory: 'not_registered',
        });
      }
      throw sendErr;
    }
  }

  private async ensureShadowCampaign(
    userId: string,
    batchId: string,
    body: string,
    whatsappAccountId: string,
  ) {
    const name = `blast:${batchId}`;
    const existing = await prisma.campaign.findFirst({ where: { userId, name } });
    if (existing) return existing;
    return prisma.campaign.create({
      data: {
        userId,
        name,
        template: body,
        status: 'running',
        source: `wa_account:${whatsappAccountId}`,
        totalRecipients: 0,
      },
    });
  }

  async stop() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}

export const messageWorker = new MessageWorker();
