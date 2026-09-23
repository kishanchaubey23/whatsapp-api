import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { getAutoReplyStats } from '../services/AutoReplyService.js';

const router = Router();
router.use(requireAuth);

const keywordSchema = z.object({
  keyword: z.string().min(1).max(200),
  matchType: z.enum(['contains', 'exact', 'starts_with']).default('contains'),
});

const ruleBodySchema = z.object({
  name: z.string().min(1).max(120),
  whatsappAccountId: z.string().uuid(),
  priority: z.number().int().min(0).max(9999).default(1),
  cooldownMinutes: z.number().int().min(0).max(10080).default(0),
  responseBody: z.string().min(1).max(4000),
  templateId: z.string().max(80).optional().nullable(),
  isActive: z.boolean().default(true),
  keywords: z.array(keywordSchema).max(50).default([]),
});

function publicRule(rule: {
  id: string;
  name: string;
  whatsappAccountId: string;
  priority: number;
  cooldownMinutes: number;
  responseBody: string;
  templateId: string | null;
  isActive: boolean;
  responseCount: number;
  createdAt: Date;
  updatedAt: Date;
  keywords?: Array<{ id: string; keyword: string; matchType: string }>;
  whatsappAccount?: { id: string; label: string; phone: string | null; status: string } | null;
}) {
  return {
    id: rule.id,
    name: rule.name,
    whatsappAccountId: rule.whatsappAccountId,
    priority: rule.priority,
    cooldownMinutes: rule.cooldownMinutes,
    responseBody: rule.responseBody,
    templateId: rule.templateId,
    isActive: rule.isActive,
    responseCount: rule.responseCount,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    keywords: (rule.keywords ?? []).map((k) => ({
      id: k.id,
      keyword: k.keyword,
      matchType: k.matchType,
    })),
    whatsappAccount: rule.whatsappAccount
      ? {
          id: rule.whatsappAccount.id,
          label: rule.whatsappAccount.label,
          phone: rule.whatsappAccount.phone,
          status: rule.whatsappAccount.status,
        }
      : undefined,
  };
}

router.get('/stats', async (req, res) => {
  const stats = await getAutoReplyStats(req.auth!.userId);
  return res.json({ success: true, stats });
});

router.get('/rules', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';

  const where: {
    userId: string;
    isActive?: boolean;
    OR?: Array<Record<string, unknown>>;
  } = { userId: req.auth!.userId };

  if (filter === 'active') where.isActive = true;
  if (filter === 'inactive') where.isActive = false;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { responseBody: { contains: q, mode: 'insensitive' } },
      { keywords: { some: { keyword: { contains: q, mode: 'insensitive' } } } },
    ];
  }

  const rules = await prisma.autoReplyRule.findMany({
    where,
    include: {
      keywords: true,
      whatsappAccount: {
        select: { id: true, label: true, phone: true, status: true },
      },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
  });

  return res.json({ success: true, rules: rules.map(publicRule) });
});

router.post('/rules', async (req, res) => {
  const parsed = ruleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  const account = await prisma.whatsAppAccount.findFirst({
    where: { id: parsed.data.whatsappAccountId, userId: req.auth!.userId },
  });
  if (!account) {
    return res.status(400).json({ success: false, error: 'WhatsApp session not found' });
  }

  const rule = await prisma.autoReplyRule.create({
    data: {
      userId: req.auth!.userId,
      whatsappAccountId: parsed.data.whatsappAccountId,
      name: parsed.data.name.trim(),
      priority: parsed.data.priority,
      cooldownMinutes: parsed.data.cooldownMinutes,
      responseBody: parsed.data.responseBody.trim(),
      templateId: parsed.data.templateId || null,
      isActive: parsed.data.isActive,
      keywords: {
        create: parsed.data.keywords.map((k) => ({
          keyword: k.keyword.trim(),
          matchType: k.matchType,
        })),
      },
    },
    include: {
      keywords: true,
      whatsappAccount: {
        select: { id: true, label: true, phone: true, status: true },
      },
    },
  });

  return res.status(201).json({ success: true, rule: publicRule(rule) });
});

router.get('/rules/:id', async (req, res) => {
  const rule = await prisma.autoReplyRule.findFirst({
    where: { id: req.params.id, userId: req.auth!.userId },
    include: {
      keywords: true,
      whatsappAccount: {
        select: { id: true, label: true, phone: true, status: true },
      },
    },
  });
  if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });
  return res.json({ success: true, rule: publicRule(rule) });
});

router.put('/rules/:id', async (req, res) => {
  const parsed = ruleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  const existing = await prisma.autoReplyRule.findFirst({
    where: { id: req.params.id, userId: req.auth!.userId },
  });
  if (!existing) return res.status(404).json({ success: false, error: 'Rule not found' });

  const account = await prisma.whatsAppAccount.findFirst({
    where: { id: parsed.data.whatsappAccountId, userId: req.auth!.userId },
  });
  if (!account) {
    return res.status(400).json({ success: false, error: 'WhatsApp session not found' });
  }

  const rule = await prisma.$transaction(async (tx) => {
    await tx.autoReplyKeyword.deleteMany({ where: { ruleId: existing.id } });
    return tx.autoReplyRule.update({
      where: { id: existing.id },
      data: {
        whatsappAccountId: parsed.data.whatsappAccountId,
        name: parsed.data.name.trim(),
        priority: parsed.data.priority,
        cooldownMinutes: parsed.data.cooldownMinutes,
        responseBody: parsed.data.responseBody.trim(),
        templateId: parsed.data.templateId || null,
        isActive: parsed.data.isActive,
        keywords: {
          create: parsed.data.keywords.map((k) => ({
            keyword: k.keyword.trim(),
            matchType: k.matchType,
          })),
        },
      },
      include: {
        keywords: true,
        whatsappAccount: {
          select: { id: true, label: true, phone: true, status: true },
        },
      },
    });
  });

  return res.json({ success: true, rule: publicRule(rule) });
});

router.patch('/rules/:id/active', async (req, res) => {
  const schema = z.object({ isActive: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }
  const existing = await prisma.autoReplyRule.findFirst({
    where: { id: req.params.id, userId: req.auth!.userId },
  });
  if (!existing) return res.status(404).json({ success: false, error: 'Rule not found' });

  const rule = await prisma.autoReplyRule.update({
    where: { id: existing.id },
    data: { isActive: parsed.data.isActive },
    include: {
      keywords: true,
      whatsappAccount: {
        select: { id: true, label: true, phone: true, status: true },
      },
    },
  });
  return res.json({ success: true, rule: publicRule(rule) });
});

router.delete('/rules/:id', async (req, res) => {
  const existing = await prisma.autoReplyRule.findFirst({
    where: { id: req.params.id, userId: req.auth!.userId },
  });
  if (!existing) return res.status(404).json({ success: false, error: 'Rule not found' });
  await prisma.autoReplyRule.delete({ where: { id: existing.id } });
  return res.json({ success: true });
});

export default router;
