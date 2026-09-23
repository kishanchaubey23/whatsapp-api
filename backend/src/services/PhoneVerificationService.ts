/**
 * PhoneVerificationService — application layer for registration checks.
 * Read-through GlobalPhoneRegistry; live check only on miss/stale.
 */

import type { Client } from 'whatsapp-web.js';
import { normalizePhone, toWhatsAppChatId, type NormalizedPhone } from '../lib/phone.js';
import {
  globalPhoneRegistryService,
  type RegistryLookupResult,
} from './GlobalPhoneRegistryService.js';
import { prisma } from '../lib/prisma.js';
import { incRegistryMetric, logRegistryEvent } from '../lib/registry-metrics.js';
import { globalRegistryRecheckService } from './GlobalRegistryRecheckService.js';

export type VerifyOneResult = {
  phone: NormalizedPhone;
  onWhatsApp: boolean;
  status: 'on_whatsapp' | 'not_on_whatsapp' | 'unknown';
  source: 'global_cache' | 'live' | 'stale_cache' | 'unknown';
  checkedAt: string | null;
  isFresh: boolean;
  /** Tenant contact row updated when userId provided */
  contactUpdated: boolean;
};

export class PhoneVerificationService {
  private static instance: PhoneVerificationService | null = null;

  static getInstance(): PhoneVerificationService {
    if (!PhoneVerificationService.instance) {
      PhoneVerificationService.instance = new PhoneVerificationService();
    }
    return PhoneVerificationService.instance;
  }

  /**
   * Verify one number with cache-first policy.
   * @param liveCheck — async fn that performs isRegisteredUser (injected so tests mock easily)
   */
  async verifyOne(params: {
    phone: string;
    userId?: string;
    sourceAccountId?: string | null;
    /** If true, recheck even when cache is fresh (e.g. user force refresh) */
    forceLive?: boolean;
    liveCheck: (normalizedPhone: NormalizedPhone) => Promise<boolean>;
  }): Promise<VerifyOneResult | null> {
    const phone = normalizePhone(params.phone);
    if (!phone) return null;

    const cached = await globalPhoneRegistryService.getFresh(phone);

    if (cached && cached.isFresh && !params.forceLive) {
      const onWhatsApp = cached.status === 'on_whatsapp';
      const contactUpdated = await this.syncTenantContact(
        params.userId,
        phone,
        onWhatsApp ? 'verified' : 'invalid',
      );
      return {
        phone,
        onWhatsApp,
        status: cached.status === 'unknown' ? 'unknown' : cached.status,
        source: 'global_cache',
        checkedAt: cached.checkedAt,
        isFresh: true,
        contactUpdated,
      };
    }

    // Stale + no live path available later: still allow caller to live-check now.
    // If forceLive is false and caller only wanted cache, they wouldn't call verifyOne with liveCheck.
    // When stale and we have a preferred account, also enqueue background recheck for others (deduped).
    if (cached?.source === 'stale_cache' && params.sourceAccountId) {
      void globalRegistryRecheckService.enqueue({
        phone,
        preferredAccountId: params.sourceAccountId,
        userId: params.userId,
        reason: 'stale_explicit_verify',
        skipIfFresh: true,
      });
    }

    // MISS or STALE → live
    incRegistryMetric('live_verification');
    incRegistryMetric('registry_live_check');
    logRegistryEvent('live_verification', {
      phone: phone.length >= 6 ? `${phone.slice(0, 3)}***${phone.slice(-3)}` : '***',
      prior: cached?.source,
    });

    const onWhatsApp = await params.liveCheck(phone);

    const updated = await globalPhoneRegistryService.upsertVerificationResult({
      phone,
      onWhatsApp,
      sourceAccountId: params.sourceAccountId,
    });

    const contactUpdated = await this.syncTenantContact(
      params.userId,
      phone,
      onWhatsApp ? 'verified' : 'invalid',
    );

    return {
      phone,
      onWhatsApp,
      status: onWhatsApp ? 'on_whatsapp' : 'not_on_whatsapp',
      source: 'live',
      checkedAt: updated?.checkedAt ?? new Date().toISOString(),
      isFresh: true,
      contactUpdated,
    };
  }

  /** Convenience using whatsapp-web.js Client */
  async verifyWithClient(params: {
    phone: string;
    client: Client;
    userId?: string;
    sourceAccountId?: string | null;
    forceLive?: boolean;
  }) {
    return this.verifyOne({
      ...params,
      liveCheck: async (normalized) => {
        return params.client.isRegisteredUser(toWhatsAppChatId(normalized));
      },
    });
  }

  private async syncTenantContact(
    userId: string | undefined,
    phone: NormalizedPhone,
    waStatus: 'verified' | 'invalid',
  ): Promise<boolean> {
    if (!userId) return false;
    const r = await prisma.contact.updateMany({
      where: { userId, phone },
      data: { waStatus },
    });
    return r.count > 0;
  }

  /** Public API list shape */
  toPublic(result: VerifyOneResult) {
    return {
      phone: result.phone,
      displayPhone: `+${result.phone}`,
      status: result.status,
      source: result.source,
      checkedAt: result.checkedAt,
      isFresh: result.isFresh,
      onWhatsApp: result.onWhatsApp,
    };
  }
}

export const phoneVerificationService = PhoneVerificationService.getInstance();
