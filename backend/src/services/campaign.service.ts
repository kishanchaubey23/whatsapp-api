import { prisma } from '../lib/prisma.js';
import { enqueueJob, publishEvent } from '../lib/redis.js';
import {
  evaluateCampaign,
  ENTERPRISE_DEFAULTS,
  type AudienceQuality,
} from '../lib/protection-engine.js';
import { assertWithinQuota, getUsageSummary } from './usage.service.js';
import { config } from '../config.js';

export type CreateCampaignBody = {
  name: string;
  template: string;
  contactIds?: string[];
  phones?: { phone: string; name?: string }[];
  sessionId?: string;
  source?: 'web' | 'extension';
  audienceQuality?: AudienceQuality;
  delayMs?: number;
  jitterEnabled?: boolean;
  batchSize?: number;
  cooldownSeconds?: number;
  spinEnabled?: boolean;
  userRiskApproved?: boolean;
};

export async function createAndGateCampaign(userId: string, body: CreateCampaignBody) {
  const audienceQuality = body.audienceQuality ?? 'opted_in';
  const delayMs = body.delayMs ?? ENTERPRISE_DEFAULTS.delayMs;
  const jitterEnabled = body.jitterEnabled ?? true;
  const batchSize = body.batchSize ?? ENTERPRISE_DEFAULTS.batchSize;
  const cooldownSeconds = body.cooldownSeconds ?? ENTERPRISE_DEFAULTS.cooldownSeconds;
  const spinEnabled = body.spinEnabled ?? true;
  const userRiskApproved = Boolean(body.userRiskApproved);

  // Resolve recipients
  let recipients: { contactId?: string; phone: string; name?: string }[] = [];

  if (body.contactIds?.length) {
    const contacts = await prisma.contact.findMany({
      where: { userId, id: { in: body.contactIds } },
    });
    recipients = contacts.map((c) => ({ contactId: c.id, phone: c.phone, name: c.name ?? undefined }));
  }

  if (body.phones?.length) {
    for (const p of body.phones) {
      const phone = p.phone.replace(/[\s\-\(\)\+]/g, '');
      if (!/^\d{7,15}$/.test(phone)) continue;
      recipients.push({ phone, name: p.name });
    }
  }

  // Dedupe by phone
  const seen = new Set<string>();
  recipients = recipients.filter((r) => {
    if (seen.has(r.phone)) return false;
    seen.add(r.phone);
    return true;
  });

  if (recipients.length === 0) {
    return { success: false as const, error: 'No valid recipients', status: 400 };
  }

  const usageCheck = await assertWithinQuota(userId, recipients.length);
  if (!usageCheck.ok) {
    return { success: false as const, error: usageCheck.error, status: 429, usage: usageCheck.summary };
  }

  const usage = await getUsageSummary(userId);
  const verdict = evaluateCampaign({
    recipientCount: recipients.length,
    delayMs,
    jitterEnabled,
    batchSize,
    cooldownSeconds,
    dailyLimit: config.plan.dailyMessageQuota,
    alreadySentToday: usage.today.messagesSent,
    spinEnabled,
    audienceQuality,
    userApproval: userRiskApproved,
  });

  let status: 'draft' | 'gated' | 'queued' | 'blocked' = 'gated';
  if (verdict.blocked) status = 'blocked';
  else if (verdict.action === 'REQUIRE_REDUCTION_OR_APPROVAL') status = 'gated';
  else if (verdict.action === 'ALLOW' || verdict.action === 'ALLOW_WITH_WARNING') status = 'queued';

  const campaign = await prisma.campaign.create({
    data: {
      userId,
      sessionId: body.sessionId,
      name: body.name,
      template: body.template,
      status,
      audienceQuality,
      delayMs,
      jitterEnabled,
      batchSize,
      cooldownSeconds,
      spinEnabled,
      protectionTier: verdict.tier,
      protectionScore: verdict.score,
      protectionAction: verdict.action,
      userRiskApproved,
      totalRecipients: recipients.length,
      source: body.source ?? 'web',
      messages: {
        create: recipients.map((r) => ({
          userId,
          contactId: r.contactId,
          phone: r.phone,
          body: body.template,
          status: status === 'queued' ? 'queued' : 'pending',
        })),
      },
    },
    include: { messages: { take: 5 } },
  });

  if (status === 'queued') {
    await enqueueJob({
      type: 'run_campaign',
      campaignId: campaign.id,
      userId,
    });
    await publishEvent(`user:${userId}`, {
      type: 'campaign_queued',
      campaignId: campaign.id,
    });
  }

  return {
    success: true as const,
    campaign: {
      id: campaign.id,
      status: campaign.status,
      totalRecipients: campaign.totalRecipients,
      protectionTier: campaign.protectionTier,
      protectionAction: campaign.protectionAction,
    },
    verdict,
    usage: usageCheck.summary,
  };
}

export async function approveAndQueueCampaign(userId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
  });
  if (!campaign) return { success: false as const, error: 'Not found', status: 404 };
  if (campaign.status === 'blocked') {
    return { success: false as const, error: 'CRITICAL campaigns cannot be approved — reduce pacing first', status: 400 };
  }

  const usage = await getUsageSummary(userId);
  const verdict = evaluateCampaign({
    recipientCount: campaign.totalRecipients,
    delayMs: campaign.delayMs,
    jitterEnabled: campaign.jitterEnabled,
    batchSize: campaign.batchSize,
    cooldownSeconds: campaign.cooldownSeconds,
    dailyLimit: config.plan.dailyMessageQuota,
    alreadySentToday: usage.today.messagesSent,
    spinEnabled: campaign.spinEnabled,
    audienceQuality: campaign.audienceQuality as AudienceQuality,
    userApproval: true,
  });

  if (verdict.blocked) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'blocked', protectionTier: verdict.tier, protectionAction: verdict.action },
    });
    return { success: false as const, error: 'Still CRITICAL after approval path', status: 400, verdict };
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: 'queued',
      userRiskApproved: true,
      protectionTier: verdict.tier,
      protectionScore: verdict.score,
      protectionAction: verdict.action,
    },
  });
  await prisma.message.updateMany({
    where: { campaignId, status: 'pending' },
    data: { status: 'queued' },
  });
  await enqueueJob({ type: 'run_campaign', campaignId, userId });
  await publishEvent(`user:${userId}`, { type: 'campaign_queued', campaignId });

  return { success: true as const, verdict };
}
