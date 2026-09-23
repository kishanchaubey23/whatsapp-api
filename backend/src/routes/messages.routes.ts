import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { publishEvent } from '../lib/redis.js';
import { recordSends } from '../services/usage.service.js';

const router = Router();
router.use(requireAuth);

/** Extension/web ACK after real WhatsApp send */
router.post('/:id/ack', async (req, res) => {
  const schema = z.object({
    status: z.enum(['sent', 'delivered', 'read', 'failed', 'skipped']),
    externalId: z.string().optional(),
    error: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });

  const msg = await prisma.message.findFirst({
    where: { id: req.params.id, userId: req.auth!.userId },
  });
  if (!msg) return res.status(404).json({ success: false, error: 'Not found' });

  const updated = await prisma.message.update({
    where: { id: msg.id },
    data: {
      status: parsed.data.status,
      externalId: parsed.data.externalId,
      error: parsed.data.error,
      sentAt: parsed.data.status === 'failed' || parsed.data.status === 'skipped' ? msg.sentAt : new Date(),
    },
  });

  if (parsed.data.status === 'failed') {
    await prisma.campaign.update({
      where: { id: msg.campaignId },
      data: { failedCount: { increment: 1 } },
    });
    await recordSends(req.auth!.userId, 0, 1, 0);
  }

  await publishEvent(`user:${req.auth!.userId}`, {
    type: 'message_ack',
    messageId: updated.id,
    campaignId: updated.campaignId,
    status: updated.status,
  });

  return res.json({ success: true, message: updated });
});

export default router;
