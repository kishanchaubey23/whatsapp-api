import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(20).optional(),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }
  const { name, email, phone, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ success: false, error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      passwordHash,
      planCode: 'enterprise',
      planActive: true,
      planPriceInr: config.plan.priceInr,
    },
  });

  const token = signToken({ userId: user.id, email: user.email, planCode: user.planCode });
  return res.status(201).json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      plan: { code: user.planCode, priceInr: user.planPriceInr },
    },
  });
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'Invalid credentials payload' });
  }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }
  if (!user.isActive) return res.status(403).json({ success: false, error: 'Account disabled' });
  if (!user.planActive) {
    return res.status(403).json({ success: false, error: 'Plan deactivated. Contact support.' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = signToken({ userId: user.id, email: user.email, planCode: user.planCode, role: 'user' });
  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      plan: { code: user.planCode, priceInr: user.planPriceInr, active: user.planActive },
    },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user) return res.status(404).json({ success: false, error: 'Not found' });
  return res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      plan: {
        code: user.planCode,
        priceInr: user.planPriceInr,
        active: user.planActive,
        dailyQuota: config.plan.dailyMessageQuota,
        monthlyQuota: config.plan.monthlyMessageQuota,
      },
    },
  });
});

export default router;
