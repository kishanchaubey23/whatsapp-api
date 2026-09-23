import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { normalizePhone, isPhoneFormatValid } from '../lib/phone.js';
import { globalPhoneRegistryService } from '../services/GlobalPhoneRegistryService.js';
import { globalRegistryRecheckService } from '../services/GlobalRegistryRecheckService.js';

const router = Router();
router.use(requireAuth);

function phoneFormatValid(phone: string): boolean {
  return isPhoneFormatValid(phone);
}

const contactBody = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(7).max(30),
  email: z.string().email().optional().or(z.literal('')),
  company: z.string().max(160).optional(),
  position: z.string().max(120).optional(),
  tags: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  groupId: z.string().uuid().optional().nullable(),
  variables: z.record(z.string()).optional(),
  audienceTag: z.enum(['saved_contacts', 'opted_in', 'mixed', 'unknown']).optional(),
});

// ─── Groups ───────────────────────────────────────────────

router.get('/groups', async (req, res) => {
  const groups = await prisma.contactGroup.findMany({
    where: { userId: req.auth!.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { contacts: true } },
      contacts: {
        select: { waStatus: true },
      },
    },
  });

  const shaped = groups.map((g) => {
    const stats = { total: g._count.contacts, verified: 0, unverified: 0, invalid: 0 };
    for (const c of g.contacts) {
      if (c.waStatus === 'verified') stats.verified++;
      else if (c.waStatus === 'invalid') stats.invalid++;
      else stats.unverified++;
    }
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      createdAt: g.createdAt,
      stats,
    };
  });

  return res.json({ success: true, groups: shaped });
});

router.post('/groups', async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(255).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });

  try {
    const group = await prisma.contactGroup.create({
      data: {
        userId: req.auth!.userId,
        name: parsed.data.name.trim(),
        description: parsed.data.description,
      },
    });
    return res.status(201).json({
      success: true,
      group: {
        ...group,
        stats: { total: 0, verified: 0, unverified: 0, invalid: 0 },
      },
    });
  } catch {
    return res.status(409).json({ success: false, error: 'A group with this name already exists' });
  }
});

router.patch('/groups/:id', async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(255).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });

  const updated = await prisma.contactGroup.updateMany({
    where: { id: req.params.id, userId: req.auth!.userId },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
    },
  });
  if (!updated.count) return res.status(404).json({ success: false, error: 'Group not found' });
  const group = await prisma.contactGroup.findFirst({ where: { id: req.params.id } });
  return res.json({ success: true, group });
});

router.delete('/groups/:id', async (req, res) => {
  // Unlink contacts then delete group
  await prisma.contact.updateMany({
    where: { groupId: req.params.id, userId: req.auth!.userId },
    data: { groupId: null },
  });
  const result = await prisma.contactGroup.deleteMany({
    where: { id: req.params.id, userId: req.auth!.userId },
  });
  if (!result.count) return res.status(404).json({ success: false, error: 'Group not found' });
  return res.json({ success: true });
});

// ─── Contacts list / CRUD ─────────────────────────────────

router.get('/', async (req, res) => {
  const groupId = typeof req.query.groupId === 'string' ? req.query.groupId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;

  const contacts = await prisma.contact.findMany({
    where: {
      userId: req.auth!.userId,
      ...(groupId ? { groupId } : {}),
      ...(status && ['verified', 'unverified', 'invalid'].includes(status)
        ? { waStatus: status as 'verified' | 'unverified' | 'invalid' }
        : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { email: { contains: q, mode: 'insensitive' } },
              { company: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });
  return res.json({ success: true, contacts });
});

router.post('/', async (req, res) => {
  const parsed = contactBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return res.status(400).json({ success: false, error: 'Invalid phone number' });

  if (parsed.data.groupId) {
    const g = await prisma.contactGroup.findFirst({
      where: { id: parsed.data.groupId, userId: req.auth!.userId },
    });
    if (!g) return res.status(400).json({ success: false, error: 'Group not found' });
  }

  const waStatus = phoneFormatValid(phone) ? 'unverified' : 'invalid';

  try {
    const contact = await prisma.contact.upsert({
      where: { userId_phone: { userId: req.auth!.userId, phone } },
      create: {
        userId: req.auth!.userId,
        groupId: parsed.data.groupId || null,
        phone,
        name: parsed.data.name,
        email: parsed.data.email || null,
        company: parsed.data.company,
        position: parsed.data.position,
        tags: parsed.data.tags,
        notes: parsed.data.notes,
        variables: parsed.data.variables || {},
        audienceTag: parsed.data.audienceTag ?? 'opted_in',
        waStatus,
      },
      update: {
        groupId: parsed.data.groupId ?? undefined,
        name: parsed.data.name,
        email: parsed.data.email || null,
        company: parsed.data.company,
        position: parsed.data.position,
        tags: parsed.data.tags,
        notes: parsed.data.notes,
        variables: parsed.data.variables || {},
        audienceTag: parsed.data.audienceTag,
      },
    });
    return res.status(201).json({ success: true, contact });
  } catch (e) {
    return res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Failed' });
  }
});

router.post('/bulk', async (req, res) => {
  const schema = z.object({
    groupId: z.string().uuid().optional().nullable(),
    contacts: z
      .array(
        z.object({
          name: z.string().optional(),
          phone: z.string(),
          email: z.string().optional(),
          company: z.string().optional(),
          position: z.string().optional(),
          tags: z.string().optional(),
          notes: z.string().optional(),
          variables: z.record(z.string()).optional(),
        }),
      )
      .min(1)
      .max(5000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });

  if (parsed.data.groupId) {
    const g = await prisma.contactGroup.findFirst({
      where: { id: parsed.data.groupId, userId: req.auth!.userId },
    });
    if (!g) return res.status(400).json({ success: false, error: 'Group not found' });
  }

  let upserted = 0;
  let invalid = 0;
  for (const c of parsed.data.contacts) {
    const phone = normalizePhone(c.phone);
    if (!phone) {
      invalid++;
      continue;
    }
    const waStatus = phoneFormatValid(phone) ? 'unverified' : 'invalid';
    await prisma.contact.upsert({
      where: { userId_phone: { userId: req.auth!.userId, phone } },
      create: {
        userId: req.auth!.userId,
        groupId: parsed.data.groupId || null,
        phone,
        name: c.name || phone,
        email: c.email || null,
        company: c.company,
        position: c.position,
        tags: c.tags,
        notes: c.notes,
        variables: c.variables || {},
        waStatus: waStatus as 'unverified' | 'invalid',
        audienceTag: 'opted_in',
      },
      update: {
        groupId: parsed.data.groupId ?? undefined,
        name: c.name,
        email: c.email || null,
        company: c.company,
        position: c.position,
        tags: c.tags,
        notes: c.notes,
        variables: c.variables || {},
      },
    });
    upserted++;
  }
  return res.json({ success: true, upserted, invalid });
});

router.patch('/:id', async (req, res) => {
  const parsed = contactBody.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });

  const existing = await prisma.contact.findFirst({
    where: { id: req.params.id, userId: req.auth!.userId },
  });
  if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

  let phone = existing.phone;
  if (parsed.data.phone) {
    const n = normalizePhone(parsed.data.phone);
    if (!n) return res.status(400).json({ success: false, error: 'Invalid phone' });
    phone = n;
  }

  const contact = await prisma.contact.update({
    where: { id: existing.id },
    data: {
      phone,
      name: parsed.data.name ?? existing.name,
      email: parsed.data.email !== undefined ? parsed.data.email || null : existing.email,
      company: parsed.data.company ?? existing.company,
      position: parsed.data.position ?? existing.position,
      tags: parsed.data.tags ?? existing.tags,
      notes: parsed.data.notes ?? existing.notes,
      variables: parsed.data.variables ?? existing.variables ?? undefined,
      groupId: parsed.data.groupId !== undefined ? parsed.data.groupId : existing.groupId,
    },
  });
  return res.json({ success: true, contact });
});

router.delete('/:id', async (req, res) => {
  await prisma.contact.deleteMany({ where: { id: req.params.id, userId: req.auth!.userId } });
  return res.json({ success: true });
});

router.post('/delete-invalid', async (req, res) => {
  const schema = z.object({ groupId: z.string().uuid().optional() });
  const parsed = schema.safeParse(req.body || {});
  const result = await prisma.contact.deleteMany({
    where: {
      userId: req.auth!.userId,
      waStatus: 'invalid',
      ...(parsed.success && parsed.data.groupId ? { groupId: parsed.data.groupId } : {}),
    },
  });
  return res.json({ success: true, deleted: result.count });
});

/**
 * Verify WhatsApp numbers (tenant Contact.waStatus).
 *
 * Order per number:
 * 1) format invalid → invalid
 * 2) GlobalPhoneRegistry fresh HIT → apply cache (no live WA here)
 * 3) optional live `results` map from Next /api/whatsapp/validate → write-through registry
 * 4) else leave unverified
 *
 * Live isRegisteredUser runs on the Next/worker WA process; this route persists + caches.
 */
router.post('/verify', async (req, res) => {
  const schema = z.object({
    groupId: z.string().uuid().optional(),
    /** Optional map phone -> boolean isOnWhatsApp from WA client (live) */
    results: z.record(z.boolean()).optional(),
    /** Internal audit only when writing live results to global registry */
    sourceAccountId: z.string().uuid().optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });

  const contacts = await prisma.contact.findMany({
    where: {
      userId: req.auth!.userId,
      ...(parsed.data.groupId ? { groupId: parsed.data.groupId } : {}),
    },
  });

  let verified = 0;
  let invalid = 0;
  let unverified = 0;
  let cacheHits = 0;
  let liveApplied = 0;
  const details: Array<{
    phone: string;
    status: string;
    source: string;
    isFresh?: boolean;
  }> = [];

  for (const c of contacts) {
    const phone = normalizePhone(c.phone) ?? c.phone;
    let status: 'verified' | 'unverified' | 'invalid' | 'blocked_or_unavailable' = 'unverified';
    let source = 'none';

    if (!phoneFormatValid(phone)) {
      status = 'invalid';
      invalid++;
      source = 'format';
    } else {
      // Prefer explicit live results when provided (write-through global)
      const liveKey =
        parsed.data.results &&
        (phone in parsed.data.results
          ? phone
          : c.phone in parsed.data.results
            ? c.phone
            : null);

      if (liveKey != null && parsed.data.results) {
        const onWa = Boolean(parsed.data.results[liveKey]);
        status = onWa ? 'verified' : 'invalid';
        source = 'live';
        liveApplied++;
        if (onWa) verified++;
        else invalid++;

        await globalPhoneRegistryService.upsertVerificationResult({
          phone,
          onWhatsApp: onWa,
          sourceAccountId: parsed.data.sourceAccountId,
        });
        } else {
          // Read-through global cache
          const cached = await globalPhoneRegistryService.getFresh(phone);
          if (cached && cached.isFresh && cached.status !== 'unknown') {
            status = cached.status === 'on_whatsapp' ? 'verified' : 'invalid';
            source = 'global_cache';
            cacheHits++;
            if (status === 'verified') verified++;
            else invalid++;
          } else {
            status = c.waStatus === 'blocked_or_unavailable' ? 'blocked_or_unavailable' : 'unverified';
            if (status === 'unverified') unverified++;
            source = cached?.source === 'stale_cache' ? 'stale_cache' : 'miss';
            // Phase 3: stale/miss without live results → deferred recheck (ownership enforced in service)
            if (parsed.data.sourceAccountId) {
              void globalRegistryRecheckService.enqueue({
                phone,
                preferredAccountId: parsed.data.sourceAccountId,
                userId: req.auth!.userId, // service rejects if account not owned by this user
                reason: source === 'stale_cache' ? 'stale_explicit_verify' : 'product_needs_fresh',
                skipIfFresh: true,
              });
            }
          }
        }
    }

    // Never overwrite blocked_or_unavailable with verified from cache alone if already blocked
    const nextStatus =
      c.waStatus === 'blocked_or_unavailable' && source !== 'live'
        ? 'blocked_or_unavailable'
        : status;

    await prisma.contact.update({
      where: { id: c.id },
      data: { waStatus: nextStatus },
    });

    details.push({
      phone,
      status: nextStatus,
      source,
      isFresh: source === 'global_cache',
    });
  }

  return res.json({
    success: true,
    verified,
    invalid,
    unverified,
    cacheHits,
    liveApplied,
    total: contacts.length,
    details: details.slice(0, 100), // sample for UI; full list can be large
    metrics: globalPhoneRegistryService.getStats(),
  });
});

export default router;
