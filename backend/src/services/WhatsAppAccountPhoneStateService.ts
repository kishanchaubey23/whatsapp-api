/**
 * Account-specific recipient state — blocked/available for THIS WhatsApp account.
 * Never written into GlobalPhoneRegistry except when evidence is globally about registration.
 */

import type { AccountPhoneRelationStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { normalizePhone } from '../lib/phone.js';

export class WhatsAppAccountPhoneStateService {
  private static instance: WhatsAppAccountPhoneStateService | null = null;

  static getInstance(): WhatsAppAccountPhoneStateService {
    if (!WhatsAppAccountPhoneStateService.instance) {
      WhatsAppAccountPhoneStateService.instance = new WhatsAppAccountPhoneStateService();
    }
    return WhatsAppAccountPhoneStateService.instance;
  }

  async get(whatsappAccountId: string, rawPhone: string) {
    const phone = normalizePhone(rawPhone);
    if (!phone) return null;
    return prisma.whatsAppAccountPhoneState.findUnique({
      where: {
        whatsappAccountId_phone: { whatsappAccountId, phone },
      },
    });
  }

  async upsert(params: {
    whatsappAccountId: string;
    phone: string;
    status: AccountPhoneRelationStatus;
    failureReason?: string | null;
    success?: boolean;
  }) {
    const phone = normalizePhone(params.phone);
    if (!phone) return null;

    const now = new Date();
    return prisma.whatsAppAccountPhoneState.upsert({
      where: {
        whatsappAccountId_phone: {
          whatsappAccountId: params.whatsappAccountId,
          phone,
        },
      },
      create: {
        whatsappAccountId: params.whatsappAccountId,
        phone,
        status: params.status,
        lastAttemptAt: now,
        lastSuccessAt: params.success ? now : null,
        lastFailureAt: params.success === false ? now : null,
        lastFailureReason: params.failureReason ?? null,
      },
      update: {
        status: params.status,
        lastAttemptAt: now,
        ...(params.success
          ? { lastSuccessAt: now, lastFailureReason: null }
          : {
              lastFailureAt: now,
              lastFailureReason: params.failureReason ?? undefined,
            }),
      },
    });
  }
}

export const waAccountPhoneStateService = WhatsAppAccountPhoneStateService.getInstance();
