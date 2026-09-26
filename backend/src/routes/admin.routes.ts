import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { requireAdmin, signToken } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/admin/login
 * Fixed admin credentials (env override).
 */
router.post('/login', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'Invalid credentials payload' });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  if (email !== config.admin.email || password !== config.admin.password) {
    return res.status(401).json({ success: false, error: 'Invalid admin email or password' });
  }

  const token = signToken({
    userId: 'admin',
    email: config.admin.email,
    planCode: 'enterprise',
    role: 'admin',
  });

  return res.json({
    success: true,
    token,
    admin: { email: config.admin.email, role: 'admin' },
  });
});

router.use(requireAdmin);

/** Dashboard overview stats */
router.get('/stats', async (_req, res) => {
  const [
    totalUsers,
    activeUsers,
    inactiveUsers,
    bannedWaAccounts,
    usersWithBannedWa,
    messagesSent,
    messagesFailed,
    messagesDelivered,
    messagesPending,
    totalBatches,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true, planActive: true } }),
    prisma.user.count({ where: { OR: [{ isActive: false }, { planActive: false }] } }),
    prisma.whatsAppAccount.count({
      where: { status: { in: ['banned', 'session_terminated'] } },
    }),
    prisma.user.count({
      where: {
        whatsappAccounts: { some: { status: { in: ['banned', 'session_terminated'] } } },
      },
    }),
    prisma.message.count({ where: { status: { in: ['sent', 'delivered', 'read'] } } }),
    prisma.message.count({ where: { status: 'failed' } }),
    prisma.message.count({ where: { status: { in: ['delivered', 'read'] } } }),
    prisma.message.count({ where: { status: { in: ['pending', 'queued', 'sending'] } } }),
    prisma.blastBatch.count(),
  ]);

  const blastAgg = await prisma.blastBatch.aggregate({
    _sum: {
      sentCount: true,
      failedCount: true,
      verifiedCount: true,
      totalNumbers: true,
      skippedCount: true,
    },
  });

  return res.json({
    success: true,
    stats: {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactiveOrPlanOff: inactiveUsers,
        withBannedWhatsApp: usersWithBannedWa,
      },
      whatsapp: {
        bannedOrTerminatedAccounts: bannedWaAccounts,
      },
      messages: {
        successful: messagesSent,
        failed: messagesFailed,
        deliveredOrRead: messagesDelivered,
        pending: messagesPending,
        /** Also from blast batch counters (may include sends without Message rows) */
        blastSent: blastAgg._sum.sentCount ?? 0,
        blastFailed: blastAgg._sum.failedCount ?? 0,
        blastVerified: blastAgg._sum.verifiedCount ?? 0,
        blastTotal: blastAgg._sum.totalNumbers ?? 0,
        blastSkipped: blastAgg._sum.skippedCount ?? 0,
      },
      campaigns: {
        totalBatches: totalBatches,
      },
    },
  });
});

/** Paginated users list */
router.get('/users', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const skip = (page - 1) * limit;

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' as const } },
          { name: { contains: q, mode: 'insensitive' as const } },
          { phone: { contains: q } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        planActive: true,
        planCode: true,
        planPriceInr: true,
        createdAt: true,
        lastLoginAt: true,
        updatedAt: true,
        _count: {
          select: {
            messages: true,
            blastBatches: true,
            whatsappAccounts: true,
            contacts: true,
          },
        },
        whatsappAccounts: {
          where: { status: { in: ['banned', 'session_terminated'] } },
          select: { id: true },
          take: 1,
        },
      },
    }),
  ]);

  return res.json({
    success: true,
    page,
    limit,
    total,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      isActive: u.isActive,
      planActive: u.planActive,
      planCode: u.planCode,
      planPriceInr: u.planPriceInr,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      counts: u._count,
      hasBannedWhatsApp: u.whatsappAccounts.length > 0,
    })),
  });
});

/** User detail for admin action panel */
router.get('/users/:id', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      planActive: true,
      planCode: true,
      planPriceInr: true,
      createdAt: true,
      lastLoginAt: true,
      updatedAt: true,
      whatsappAccounts: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          label: true,
          phone: true,
          businessName: true,
          status: true,
          riskScore: true,
          lastReadyAt: true,
          lastError: true,
          createdAt: true,
        },
      },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      blastBatches: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          kind: true,
          totalNumbers: true,
          sentCount: true,
          failedCount: true,
          createdAt: true,
          completedAt: true,
          payload: true,
        },
      },
      _count: {
        select: {
          messages: true,
          contacts: true,
          contactGroups: true,
          blastBatches: true,
          whatsappAccounts: true,
        },
      },
    },
  });

  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const messageStats = await prisma.message.groupBy({
    by: ['status'],
    where: { userId: user.id },
    _count: { _all: true },
  });

  return res.json({
    success: true,
    user: {
      ...user,
      messageStats: Object.fromEntries(messageStats.map((m) => [m.status, m._count._all])),
    },
  });
});

/** Deactivate / activate plan (and optionally account) */
router.post('/users/:id/deactivate-plan', async (req, res) => {
  const schema = z.object({
    planActive: z.boolean(),
    /** Also lock login when true */
    deactivateAccount: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ success: false, error: 'User not found' });

  const isActivating = parsed.data.planActive;

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      planActive: isActivating,
      planCode: isActivating ? 'enterprise' : 'free',
      planPriceInr: isActivating ? config.plan.priceInr : 0,
      isActive: isActivating
        ? true
        : parsed.data.deactivateAccount
          ? false
          : existing.isActive,
    },
    select: {
      id: true,
      email: true,
      planCode: true,
      planActive: true,
      planPriceInr: true,
      isActive: true,
    },
  });

  return res.json({ success: true, user });
});

/** Toggle user active (login lock) */
router.post('/users/:id/set-active', async (req, res) => {
  const schema = z.object({ isActive: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: parsed.data.isActive },
    select: { id: true, email: true, isActive: true, planActive: true },
  });
  return res.json({ success: true, user });
});

/** Add a payment record (admin) */
router.post('/users/:id/payments', async (req, res) => {
  const schema = z.object({
    amountInr: z.number().int().min(0).default(5000),
    status: z.enum(['pending', 'paid', 'failed', 'refunded', 'cancelled']).optional(),
    method: z.string().max(64).optional(),
    reference: z.string().max(120).optional(),
    note: z.string().max(255).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ success: false, error: 'User not found' });

  const payment = await prisma.payment.create({
    data: {
      userId: existing.id,
      amountInr: parsed.data.amountInr ?? existing.planPriceInr,
      status: parsed.data.status ?? 'paid',
      method: parsed.data.method ?? 'manual',
      reference: parsed.data.reference,
      note: parsed.data.note ?? 'Enterprise plan',
      paidAt: (parsed.data.status ?? 'paid') === 'paid' ? new Date() : null,
    },
  });
  return res.status(201).json({ success: true, payment });
});

export default router;
