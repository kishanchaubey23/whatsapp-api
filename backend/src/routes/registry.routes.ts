import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { globalPhoneRegistryService } from '../services/GlobalPhoneRegistryService.js';
import { globalRegistryRecheckService } from '../services/GlobalRegistryRecheckService.js';
import { normalizePhone } from '../lib/phone.js';
import { getRecheckQuotaCount, utcDateKey } from '../lib/recheck-quota.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

const LOOKUP_BATCH_MAX = 500;

/**
 * GET /api/registry/lookup?phone=
 * Never exposes sourceAccountId or tenant identity.
 */
router.get('/lookup', async (req, res) => {
  const phone = typeof req.query.phone === 'string' ? req.query.phone : '';
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return res.status(400).json({ success: false, error: 'Invalid phone' });
  }

  const result = await globalPhoneRegistryService.getFresh(normalized);
  if (!result) {
    return res.status(400).json({ success: false, error: 'Invalid phone' });
  }

  return res.json({
    success: true,
    ...globalPhoneRegistryService.toPublicResponse(result),
  });
});

/**
 * POST /api/registry/lookup-batch — cache-only, capped
 */
router.post('/lookup-batch', async (req, res) => {
  const schema = z.object({
    phones: z.array(z.string()).min(1).max(LOOKUP_BATCH_MAX),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  const results = [];
  for (const raw of parsed.data.phones) {
    const r = await globalPhoneRegistryService.getFresh(raw);
    if (r) results.push(globalPhoneRegistryService.toPublicResponse(r));
  }

  return res.json({
    success: true,
    results,
    count: results.length,
  });
});

router.get('/metrics', async (_req, res) => {
  const queueCounts = await globalRegistryRecheckService.getQueueCounts().catch(() => null);
  return res.json({
    success: true,
    metrics: globalPhoneRegistryService.getStats(),
    recheckQueue: queueCounts,
    quota: {
      timezone: 'UTC',
      date: utcDateKey(),
      dailyCapPerAccount: config.registryRecheck.dailyCapPerAccount,
      unit: 'live_verification_attempts',
    },
  });
});

/**
 * POST /api/registry/recheck
 * preferredAccountId MUST belong to authenticated user.
 */
router.post('/recheck', async (req, res) => {
  const schema = z.object({
    phone: z.string().min(7),
    preferredAccountId: z.string().uuid(),
    reason: z
      .enum([
        'stale_explicit_verify',
        'ambiguous_send_result',
        'evidence_conflict',
        'product_needs_fresh',
        'manual',
      ])
      .optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  const outcome = await globalRegistryRecheckService.enqueue({
    phone: parsed.data.phone,
    preferredAccountId: parsed.data.preferredAccountId,
    userId: req.auth!.userId,
    reason: parsed.data.reason ?? 'manual',
    skipIfFresh: true,
  });

  if (outcome.outcome === 'rejected_ownership') {
    return res.status(403).json({ success: false, error: outcome.error, enqueue: outcome });
  }

  const lookup = await globalPhoneRegistryService.getFresh(parsed.data.phone);
  const quotaUsed = await getRecheckQuotaCount(parsed.data.preferredAccountId).catch(() => 0);

  return res.status(202).json({
    success: true,
    enqueue: outcome,
    current: lookup ? globalPhoneRegistryService.toPublicResponse(lookup) : null,
    quota: {
      used: quotaUsed,
      cap: config.registryRecheck.dailyCapPerAccount,
      date: utcDateKey(),
      timezone: 'UTC',
    },
  });
});

export default router;
