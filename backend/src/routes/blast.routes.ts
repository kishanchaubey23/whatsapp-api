import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { queueService } from '../services/QueueService.js';
import { prisma } from '../lib/prisma.js';
import { wwbClientFactory } from '../services/WWBClientFactory.js';
import { config } from '../config.js';
import { normalizePhone } from '../lib/phone.js';

const router = Router();
router.use(requireAuth);

function publicAccount(a: {
  id: string;
  label: string;
  phone: string | null;
  businessName: string | null;
  status: string;
  lastReadyAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: a.id,
    label: a.label,
    phone: a.phone,
    businessName: a.businessName,
    status: a.status,
    lastReadyAt: a.lastReadyAt,
    createdAt: a.createdAt,
  };
}

/**
 * Resolve recipient phones from selection (server is source of truth).
 * Prefers verified contacts; falls back to all non-invalid if none verified.
 */
async function resolveRecipientPhones(params: {
  userId: string;
  selectionMethod?: 'groups' | 'all_verified' | 'manual' | 'phones';
  groupIds?: string[];
  contactIds?: string[];
  phones?: string[];
}): Promise<string[]> {
  const method = params.selectionMethod ?? (params.phones?.length ? 'phones' : 'manual');
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const n = normalizePhone(raw);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  if (method === 'phones' && params.phones?.length) {
    for (const p of params.phones) push(p);
    return out;
  }

  if (method === 'all_verified') {
    const rows = await prisma.contact.findMany({
      where: { userId: params.userId, waStatus: 'verified' },
      select: { phone: true },
      take: config.maxBatchSize,
    });
    for (const r of rows) push(r.phone);
    return out;
  }

  if (method === 'groups' && params.groupIds?.length) {
    // Ownership: only this user's groups
    const groups = await prisma.contactGroup.findMany({
      where: { userId: params.userId, id: { in: params.groupIds } },
      select: { id: true },
    });
    const gids = groups.map((g) => g.id);
    if (!gids.length) return out;

    let rows = await prisma.contact.findMany({
      where: { userId: params.userId, groupId: { in: gids }, waStatus: 'verified' },
      select: { phone: true },
      take: config.maxBatchSize,
    });
    // If no verified, include unverified (not invalid/blocked) so campaigns can still run verify_and_send
    if (rows.length === 0) {
      rows = await prisma.contact.findMany({
        where: {
          userId: params.userId,
          groupId: { in: gids },
          waStatus: { in: ['unverified', 'verified'] },
        },
        select: { phone: true },
        take: config.maxBatchSize,
      });
    }
    for (const r of rows) push(r.phone);
    return out;
  }

  if (method === 'manual' && params.contactIds?.length) {
    const rows = await prisma.contact.findMany({
      where: {
        userId: params.userId,
        id: { in: params.contactIds },
        waStatus: { notIn: ['invalid', 'blocked_or_unavailable'] },
      },
      select: { phone: true },
      take: config.maxBatchSize,
    });
    for (const r of rows) push(r.phone);
    return out;
  }

  // Fallback raw phones
  if (params.phones?.length) {
    for (const p of params.phones) push(p);
  }
  return out;
}

/**
 * POST /api/blast
 * Accepts phones[] OR selectionMethod + groupIds/contactIds (server resolves).
 */
router.post('/', async (req, res) => {
  const schema = z.object({
    whatsappAccountId: z.string().uuid(),
    /** Optional multi-select from UI — first ready account is primary; extras stored in payload */
    whatsappAccountIds: z.array(z.string().uuid()).max(10).optional(),
    phones: z.array(z.string()).max(config.maxBatchSize).optional(),
    messageBody: z.string().min(1).max(4096).optional(),
    kind: z.enum(['verify', 'send', 'verify_and_send']).optional(),
    name: z.string().max(160).optional(),
    selectionMethod: z.enum(['groups', 'all_verified', 'manual', 'phones']).optional(),
    groupIds: z.array(z.string().uuid()).max(100).optional(),
    contactIds: z.array(z.string().uuid()).max(config.maxBatchSize).optional(),
    /** UI-only metadata stored on batch payload — not used to bypass pacing */
    delaySeconds: z.number().int().min(0).max(300).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    scheduleType: z.enum(['immediate', 'later']).optional(),
    scheduledAt: z.string().datetime().optional(),
    messageType: z.enum(['text', 'template']).optional(),
    templateId: z.string().optional(),
    attachmentName: z.string().max(255).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  const d = parsed.data;
  const primaryAccountId = d.whatsappAccountId;

  try {
    const phones = await resolveRecipientPhones({
      userId: req.auth!.userId,
      selectionMethod: d.selectionMethod,
      groupIds: d.groupIds,
      contactIds: d.contactIds,
      phones: d.phones,
    });

    if (phones.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No eligible recipients. Select groups/contacts with valid numbers, or verify contacts first.',
      });
    }

    const kind = d.kind ?? (d.messageBody ? 'verify_and_send' : 'verify');
    if (kind !== 'verify' && !d.messageBody?.trim()) {
      return res.status(400).json({ success: false, error: 'messageBody is required for send campaigns' });
    }

    const result = await queueService.ingestBlast({
      userId: req.auth!.userId,
      whatsappAccountId: primaryAccountId,
      phones,
      messageBody: d.messageBody,
      kind,
      name: d.name,
    });

    // Attach UI metadata without changing queue contract
    await prisma.blastBatch.update({
      where: { id: result.batchId },
      data: {
        payload: {
          name: d.name ?? null,
          phoneCount: phones.length,
          chunkTotal: result.chunks,
          selectionMethod: d.selectionMethod ?? null,
          groupIds: d.groupIds ?? [],
          contactIds: d.contactIds ?? [],
          whatsappAccountIds: d.whatsappAccountIds ?? [primaryAccountId],
          delaySeconds: d.delaySeconds ?? null,
          maxRetries: d.maxRetries ?? null,
          scheduleType: d.scheduleType ?? 'immediate',
          scheduledAt: d.scheduledAt ?? null,
          messageType: d.messageType ?? 'text',
          templateId: d.templateId ?? null,
          attachmentName: d.attachmentName ?? null,
          // Note: delaySeconds is metadata only — worker anti-ban sleep remains authoritative
          pacingNote: 'Worker anti-ban sleep (20–45s) is enforced regardless of UI delay',
        },
      },
    });

    return res.status(202).json({
      success: true,
      batchId: result.batchId,
      status: result.status,
      totalNumbers: result.totalNumbers,
      chunks: result.chunks,
      jobIds: result.jobIds,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Ingest failed';
    return res.status(status).json({ success: false, error: message });
  }
});

/** List recent batches for the user */
router.get('/', async (req, res) => {
  const batches = await prisma.blastBatch.findMany({
    where: { userId: req.auth!.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      whatsappAccount: {
        select: { id: true, label: true, phone: true, status: true },
      },
    },
  });
  return res.json({ success: true, batches });
});

/** Static paths MUST be registered before /:batchId */
router.post('/accounts', async (req, res) => {
  const schema = z.object({
    label: z.string().min(1).max(120),
    proxyHost: z.string().optional(),
    proxyPort: z.number().int().optional(),
    proxyUsername: z.string().optional(),
    proxyPassword: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });

  const sessionKey = `wa_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const account = await prisma.whatsAppAccount.create({
    data: {
      userId: req.auth!.userId,
      label: parsed.data.label,
      sessionKey,
      proxyHost: parsed.data.proxyHost || config.proxy.host || null,
      proxyPort: parsed.data.proxyPort || config.proxy.port || null,
      proxyUsername: parsed.data.proxyUsername || config.proxy.username || null,
      proxyPassword: parsed.data.proxyPassword || config.proxy.password || null,
      status: 'pending_qr',
    },
  });

  return res.status(201).json({ success: true, account: publicAccount(account) });
});

router.get('/accounts/list', async (req, res) => {
  const accounts = await prisma.whatsAppAccount.findMany({
    where: { userId: req.auth!.userId },
    orderBy: { createdAt: 'desc' },
  });
  // Never expose sessionKey, proxy credentials, risk internals
  return res.json({
    success: true,
    accounts: accounts.map(publicAccount),
    live: wwbClientFactory.listStatuses().map((l) => ({
      accountId: l.accountId,
      status: l.status,
      hasQr: l.hasQr,
    })),
  });
});

router.post('/accounts/:id/connect', async (req, res) => {
  const account = await prisma.whatsAppAccount.findFirst({
    where: { id: req.params.id, userId: req.auth!.userId },
  });
  if (!account) return res.status(404).json({ success: false, error: 'Not found' });

  try {
    const managed = await wwbClientFactory.getOrCreate(account.id);
    return res.json({
      success: true,
      status: managed.status,
      qr: managed.qr,
      accountId: account.id,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Connect failed',
    });
  }
});

router.get('/accounts/:id/status', async (req, res) => {
  const account = await prisma.whatsAppAccount.findFirst({
    where: { id: req.params.id, userId: req.auth!.userId },
  });
  if (!account) return res.status(404).json({ success: false, error: 'Not found' });
  const live = wwbClientFactory.get(account.id);
  return res.json({
    success: true,
    account: publicAccount(account),
    live: live ? { status: live.status, qr: live.qr, lastError: live.lastError } : null,
  });
});

/** Preview recipient count without creating a batch */
router.post('/preview-recipients', async (req, res) => {
  const schema = z.object({
    selectionMethod: z.enum(['groups', 'all_verified', 'manual', 'phones']),
    groupIds: z.array(z.string().uuid()).optional(),
    contactIds: z.array(z.string().uuid()).optional(),
    phones: z.array(z.string()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }
  const phones = await resolveRecipientPhones({
    userId: req.auth!.userId,
    ...parsed.data,
  });
  return res.json({
    success: true,
    count: phones.length,
    // Do not return full phone list for large sets — sample only
    sample: phones.slice(0, 5),
  });
});

router.get('/:batchId', async (req, res) => {
  // Guard static path collisions
  if (req.params.batchId === 'accounts' || req.params.batchId === 'preview-recipients') {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  const data = await queueService.getBatchStatus(req.auth!.userId, req.params.batchId);
  if (!data) return res.status(404).json({ success: false, error: 'Batch not found' });
  return res.json({ success: true, ...data });
});

router.post('/:batchId/cancel', async (req, res) => {
  const batch = await queueService.cancelBatch(req.auth!.userId, req.params.batchId);
  if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });
  return res.json({ success: true, batch });
});

export default router;
