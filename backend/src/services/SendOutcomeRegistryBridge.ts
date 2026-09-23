/**
 * SendOutcomeRegistryBridge
 * -------------------------
 * Maps classified send/verify outcomes → global vs account-specific writes.
 * Single place for Phase 2 event-driven registry rules (no second classifier).
 */

import { classifyWaError, type WaErrorCategory } from '../lib/wa-error-classifier.js';
import { globalPhoneRegistryService } from './GlobalPhoneRegistryService.js';
import { waAccountPhoneStateService } from './WhatsAppAccountPhoneStateService.js';
import { globalRegistryRecheckService } from './GlobalRegistryRecheckService.js';
import { normalizePhone } from '../lib/phone.js';
import { prisma } from '../lib/prisma.js';

export type SendOutcomeContext = {
  phone: string;
  userId?: string;
  whatsappAccountId?: string | null;
};

/**
 * Apply a successful send to global + account state.
 */
export async function onSendSuccess(ctx: SendOutcomeContext): Promise<void> {
  const phone = normalizePhone(ctx.phone);
  if (!phone) return;

  await globalPhoneRegistryService.markOnWhatsApp(phone, ctx.whatsappAccountId);
  if (ctx.whatsappAccountId) {
    await waAccountPhoneStateService.upsert({
      whatsappAccountId: ctx.whatsappAccountId,
      phone,
      status: 'send_success',
      success: true,
    });
  }
  if (ctx.userId) {
    await prisma.contact
      .updateMany({ where: { userId: ctx.userId, phone }, data: { waStatus: 'verified' } })
      .catch(() => undefined);
  }
}

/**
 * Apply a classified failure. Returns whether global was updated.
 */
export async function onSendOrVerifyFailure(
  ctx: SendOutcomeContext,
  err: unknown,
): Promise<{ category: WaErrorCategory; globalUpdated: boolean }> {
  const phone = normalizePhone(ctx.phone);
  const classified = classifyWaError(err);
  if (!phone) return { category: classified.category, globalUpdated: false };

  // 1) Registration evidence → global
  if (classified.category === 'not_registered') {
    await globalPhoneRegistryService.markNotOnWhatsApp(phone, ctx.whatsappAccountId);
    if (ctx.whatsappAccountId) {
      await waAccountPhoneStateService.upsert({
        whatsappAccountId: ctx.whatsappAccountId,
        phone,
        status: 'not_registered',
        success: false,
        failureReason: classified.message.slice(0, 500),
      });
    }
    if (ctx.userId) {
      await prisma.contact
        .updateMany({ where: { userId: ctx.userId, phone }, data: { waStatus: 'invalid' } })
        .catch(() => undefined);
    }
    return { category: classified.category, globalUpdated: true };
  }

  // 2) Blocked / relationship → account only
  if (classified.category === 'target_blocked') {
    if (ctx.whatsappAccountId) {
      await waAccountPhoneStateService.upsert({
        whatsappAccountId: ctx.whatsappAccountId,
        phone,
        status: 'blocked_or_unavailable',
        success: false,
        failureReason: classified.message.slice(0, 500),
      });
    }
    if (ctx.userId) {
      await prisma.contact
        .updateMany({
          where: { userId: ctx.userId, phone },
          data: { waStatus: 'blocked_or_unavailable' },
        })
        .catch(() => undefined);
    }
    return { category: classified.category, globalUpdated: false };
  }

  // 3) Session / infra → no global change; optional ambiguous recheck later if stale
  if (classified.isSessionFatal || classified.category === 'session_dead') {
    return { category: classified.category, globalUpdated: false };
  }

  // 4) Rate limit / unknown — may enqueue deferred recheck if stale, no immediate flip
  if (classified.category === 'rate_limited' || classified.category === 'unknown') {
    if (ctx.whatsappAccountId) {
      await waAccountPhoneStateService.upsert({
        whatsappAccountId: ctx.whatsappAccountId,
        phone,
        status: 'send_failed',
        success: false,
        failureReason: classified.message.slice(0, 500),
      });
    }
    const fresh = await globalPhoneRegistryService.getFresh(phone);
    if (!fresh?.isFresh && ctx.whatsappAccountId) {
      await globalRegistryRecheckService.enqueue({
        phone,
        preferredAccountId: ctx.whatsappAccountId,
        userId: ctx.userId,
        reason: 'ambiguous_send_result',
        skipIfFresh: true,
      });
    }
    return { category: classified.category, globalUpdated: false };
  }

  return { category: classified.category, globalUpdated: false };
}

/**
 * After a cache-stale explicit verify request, enqueue deferred recheck if still needed.
 */
export async function enqueueStaleVerifyRecheck(params: {
  phone: string;
  preferredAccountId?: string | null;
  userId?: string | null;
}) {
  return globalRegistryRecheckService.enqueue({
    phone: params.phone,
    preferredAccountId: params.preferredAccountId,
    userId: params.userId,
    reason: 'stale_explicit_verify',
    skipIfFresh: true,
  });
}
