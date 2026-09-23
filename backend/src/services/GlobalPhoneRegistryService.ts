/**
 * GlobalPhoneRegistryService
 * --------------------------
 * Owns ALL platform-wide registration cache logic (TTL, freshness, upsert).
 * Controllers/workers must not query GlobalPhoneRegistry via Prisma directly.
 *
 * Does NOT encode:
 * - tenant CRM
 * - account-specific blocked/available
 * - message delivery outcome (except when it proves global registration)
 */

import type { GlobalPhoneRegistry, GlobalWaRegStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { normalizePhone, maskPhone, type NormalizedPhone } from '../lib/phone.js';
import {
  incRegistryMetric,
  logRegistryEvent,
  getRegistryMetrics,
} from '../lib/registry-metrics.js';

export type RegistrySource = 'global_cache' | 'live' | 'stale_cache' | 'unknown';

export type RegistryLookupResult = {
  phone: NormalizedPhone;
  status: GlobalWaRegStatus;
  source: RegistrySource;
  checkedAt: string | null;
  lastConfirmedAt: string | null;
  isFresh: boolean;
  expiresAt: string | null;
  checkCount: number;
};

function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function computeExpiresAt(status: GlobalWaRegStatus, from = new Date()): Date | null {
  if (status === 'on_whatsapp') {
    return new Date(from.getTime() + daysToMs(config.globalWa.positiveTtlDays));
  }
  if (status === 'not_on_whatsapp') {
    return new Date(from.getTime() + daysToMs(config.globalWa.negativeTtlDays));
  }
  return null;
}

function rowToResult(
  phone: NormalizedPhone,
  row: GlobalPhoneRegistry | null,
  forceSource?: RegistrySource,
): RegistryLookupResult {
  if (!row) {
    return {
      phone,
      status: 'unknown',
      source: forceSource ?? 'unknown',
      checkedAt: null,
      lastConfirmedAt: null,
      isFresh: false,
      expiresAt: null,
      checkCount: 0,
    };
  }

  const isFresh = isFreshRow(row);
  let source: RegistrySource = forceSource ?? (isFresh ? 'global_cache' : 'stale_cache');
  if (row.status === 'unknown') source = forceSource ?? 'unknown';

  return {
    phone,
    status: row.status,
    source,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    lastConfirmedAt: row.lastConfirmedAt?.toISOString() ?? null,
    isFresh,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    checkCount: row.checkCount,
  };
}

function isFreshRow(row: GlobalPhoneRegistry, now = new Date()): boolean {
  if (row.status === 'unknown') return false;
  if (!row.expiresAt) return false;
  return row.expiresAt.getTime() > now.getTime();
}

export class GlobalPhoneRegistryService {
  private static instance: GlobalPhoneRegistryService | null = null;

  static getInstance(): GlobalPhoneRegistryService {
    if (!GlobalPhoneRegistryService.instance) {
      GlobalPhoneRegistryService.instance = new GlobalPhoneRegistryService();
    }
    return GlobalPhoneRegistryService.instance;
  }

  isFresh(row: GlobalPhoneRegistry | null | undefined): boolean {
    if (!row) return false;
    return isFreshRow(row);
  }

  /** Raw get by normalized phone (no metrics). */
  async get(rawPhone: string): Promise<GlobalPhoneRegistry | null> {
    const phone = normalizePhone(rawPhone);
    if (!phone) return null;
    return prisma.globalPhoneRegistry.findUnique({ where: { phone } });
  }

  /**
   * Lookup with freshness. Increments metrics.
   * Fresh HIT → isFresh true, source global_cache
   * STALE → isFresh false, source stale_cache
   * MISS → unknown / miss
   */
  async getFresh(rawPhone: string): Promise<RegistryLookupResult | null> {
    const phone = normalizePhone(rawPhone);
    if (!phone) return null;

    incRegistryMetric('registry_lookup');
    const row = await prisma.globalPhoneRegistry.findUnique({ where: { phone } });

    if (!row || row.status === 'unknown') {
      incRegistryMetric('registry_miss');
      logRegistryEvent('registry_miss', { phone: maskPhone(phone) });
      return rowToResult(phone, row);
    }

    if (isFreshRow(row)) {
      incRegistryMetric('registry_hit');
      logRegistryEvent('registry_hit', { phone: maskPhone(phone), status: row.status });
      return rowToResult(phone, row, 'global_cache');
    }

    incRegistryMetric('registry_stale');
    logRegistryEvent('registry_stale', {
      phone: maskPhone(phone),
      status: row.status,
      expiresAt: row.expiresAt,
    });
    return rowToResult(phone, row, 'stale_cache');
  }

  /**
   * Write live verification result (upsert by unique phone).
   * Race-safe via Prisma upsert on unique phone.
   */
  async upsertVerificationResult(params: {
    phone: string;
    onWhatsApp: boolean;
    /** Internal audit only — never expose */
    sourceAccountId?: string | null;
    confidence?: number;
  }): Promise<RegistryLookupResult | null> {
    const phone = normalizePhone(params.phone);
    if (!phone) return null;

    const status: GlobalWaRegStatus = params.onWhatsApp ? 'on_whatsapp' : 'not_on_whatsapp';
    const now = new Date();
    const expiresAt = computeExpiresAt(status, now);
    const confidence = Math.min(100, Math.max(0, params.confidence ?? 60));

    const previous = await prisma.globalPhoneRegistry.findUnique({ where: { phone } });

    const row = await prisma.globalPhoneRegistry.upsert({
      where: { phone },
      create: {
        phone,
        status,
        checkedAt: now,
        lastConfirmedAt: now,
        checkCount: 1,
        confidence,
        sourceAccountId: params.sourceAccountId ?? null,
        expiresAt,
      },
      update: {
        status,
        checkedAt: now,
        lastConfirmedAt: now,
        checkCount: { increment: 1 },
        confidence,
        sourceAccountId: params.sourceAccountId ?? undefined,
        expiresAt,
      },
    });

    incRegistryMetric('global_status_updated');
    if (
      previous &&
      previous.status !== 'unknown' &&
      previous.status !== status &&
      (previous.status === 'on_whatsapp' || previous.status === 'not_on_whatsapp')
    ) {
      incRegistryMetric('registry_status_flip');
      logRegistryEvent('registry_status_flip', {
        phone: maskPhone(phone),
        from: previous.status,
        to: status,
      });
    }
    logRegistryEvent('global_status_updated', { phone: maskPhone(phone), status });

    return rowToResult(phone, row, 'live');
  }

  async markOnWhatsApp(phone: string, sourceAccountId?: string | null) {
    return this.upsertVerificationResult({ phone, onWhatsApp: true, sourceAccountId, confidence: 70 });
  }

  async markNotOnWhatsApp(phone: string, sourceAccountId?: string | null) {
    return this.upsertVerificationResult({
      phone,
      onWhatsApp: false,
      sourceAccountId,
      confidence: 70,
    });
  }

  async invalidate(rawPhone: string): Promise<void> {
    const phone = normalizePhone(rawPhone);
    if (!phone) return;
    await prisma.globalPhoneRegistry.updateMany({
      where: { phone },
      data: {
        status: 'unknown',
        expiresAt: new Date(0),
      },
    });
    logRegistryEvent('invalidate', { phone: maskPhone(phone) });
  }

  getStats() {
    return getRegistryMetrics();
  }

  /**
   * Public API shape — never includes sourceAccountId or tenant identity.
   */
  toPublicResponse(result: RegistryLookupResult) {
    return {
      phone: result.phone,
      displayPhone: `+${result.phone}`,
      status: result.status,
      source: result.source,
      checkedAt: result.checkedAt,
      isFresh: result.isFresh,
      expiresAt: result.expiresAt,
    };
  }
}

export const globalPhoneRegistryService = GlobalPhoneRegistryService.getInstance();
