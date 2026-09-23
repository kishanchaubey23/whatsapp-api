import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { createAndGateCampaign, approveAndQueueCampaign } from '../services/campaign.service.js';
import { evaluateCampaign, optimizePlan, ENTERPRISE_DEFAULTS } from '../lib/protection-engine.js';
import { getUsageSummary } from '../services/usage.service.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const campaigns = await prisma.campaign.findMany({
    where: { userId: req.auth!.userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return res.json({ success: true, campaigns });
});

router.get('/:id', async (req, res) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, userId: req.auth!.userId },
    include: {
      messages: { take: 200, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!campaign) return res.status(404).json({ success: false, error: 'Not found' });
  return res.json({ success: true, campaign });
});

router.post('/', async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(160),
    template: z.string().min(1),
    contactIds: z.array(z.string().uuid()).optional(),
    phones: z.array(z.object({ phone: z.string(), name: z.string().optional() })).optional(),
    sessionId: z.string().uuid().optional(),
    source: z.enum(['web', 'extension']).optional(),
    audienceQuality: z.enum(['saved_contacts', 'opted_in', 'mixed', 'unknown']).optional(),
    delayMs: z.number().int().min(1000).max(120000).optional(),
    jitterEnabled: z.boolean().optional(),
    batchSize: z.number().int().min(1).max(100).optional(),
    cooldownSeconds: z.number().int().min(0).max(600).optional(),
    spinEnabled: z.boolean().optional(),
    userRiskApproved: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });

  const result = await createAndGateCampaign(req.auth!.userId, parsed.data);
  if (!result.success) {
    return res.status(result.status ?? 400).json(result);
  }
  return res.status(201).json(result);
});

router.post('/:id/approve', async (req, res) => {
  const result = await approveAndQueueCampaign(req.auth!.userId, req.params.id);
  if (!result.success) return res.status(result.status ?? 400).json(result);
  return res.json(result);
});

router.post('/protect/evaluate', async (req, res) => {
  const usage = await getUsageSummary(req.auth!.userId);
  const verdict = evaluateCampaign({
    recipientCount: Number(req.body.recipientCount ?? 0),
    delayMs: Number(req.body.delayMs ?? ENTERPRISE_DEFAULTS.delayMs),
    jitterEnabled: req.body.jitterEnabled !== false,
    batchSize: Number(req.body.batchSize ?? ENTERPRISE_DEFAULTS.batchSize),
    cooldownSeconds: Number(req.body.cooldownSeconds ?? ENTERPRISE_DEFAULTS.cooldownSeconds),
    dailyLimit: config.plan.dailyMessageQuota,
    alreadySentToday: usage.today.messagesSent,
    spinEnabled: req.body.spinEnabled !== false,
    audienceQuality: req.body.audienceQuality ?? 'opted_in',
    userApproval: Boolean(req.body.userRiskApproved),
  });
  return res.json({ success: true, verdict, usage });
});

router.post('/protect/plan', async (req, res) => {
  const usage = await getUsageSummary(req.auth!.userId);
  const n = Number(req.body.recipientCount ?? 0);
  if (n <= 0) return res.status(400).json({ success: false, error: 'recipientCount required' });
  const plan = optimizePlan(n, {
    audienceQuality: req.body.audienceQuality ?? 'opted_in',
    alreadySentToday: usage.today.messagesSent,
    dailyLimit: config.plan.dailyMessageQuota,
  });
  return res.json({
    success: true,
    plan,
    enterprise: { priceInr: config.plan.priceInr, code: config.plan.code },
  });
});

export default router;
