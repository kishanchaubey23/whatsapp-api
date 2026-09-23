/**
 * GlobalRegistryRecheckService
 * ----------------------------
 * BullMQ queue: registry-recheck (isolated from wa-blast-jobs).
 * Dedupe: deterministic jobId `registry-recheck:{phone}` — BullMQ rejects duplicate IDs.
 * Ownership: preferredAccountId must belong to userId when both provided.
 */

import { Queue, type JobsOptions } from 'bullmq';
import { config } from '../config.js';
import { normalizePhone, maskPhone } from '../lib/phone.js';
import { prisma } from '../lib/prisma.js';
import { globalPhoneRegistryService } from './GlobalPhoneRegistryService.js';
import { incRegistryMetric, logRegistryEvent } from '../lib/registry-metrics.js';

export type RegistryRecheckReason =
  | 'stale_explicit_verify'
  | 'ambiguous_send_result'
  | 'evidence_conflict'
  | 'product_needs_fresh'
  | 'manual';

export type RegistryRecheckJobPayload = {
  phone: string;
  preferredAccountId: string | null;
  userId: string | null;
  reason: RegistryRecheckReason;
  enqueuedAt: string;
};

const JOB_OPTS: JobsOptions = {
  attempts: config.registryRecheck.jobAttempts,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

function isDuplicateJobError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Job.*already exists|already exists|duplicate/i.test(msg);
}

export class GlobalRegistryRecheckService {
  private static instance: GlobalRegistryRecheckService | null = null;
  private _queue: Queue<RegistryRecheckJobPayload> | null = null;

  private constructor() {}

  static getInstance(): GlobalRegistryRecheckService {
    if (!GlobalRegistryRecheckService.instance) {
      GlobalRegistryRecheckService.instance = new GlobalRegistryRecheckService();
    }
    return GlobalRegistryRecheckService.instance;
  }

  /** Lazy queue — avoid Redis connect on module import (keeps unit tests offline). */
  get queue(): Queue<RegistryRecheckJobPayload> {
    if (!this._queue) {
      this._queue = new Queue<RegistryRecheckJobPayload>(config.registryRecheck.queueName, {
        connection: config.redisConnection,
        defaultJobOptions: JOB_OPTS,
      });
    }
    return this._queue;
  }

  jobIdForPhone(phone: string): string {
    return `registry-recheck:${phone}`;
  }

  /**
   * Validate preferredAccountId belongs to userId (multi-tenant safety).
   */
  async assertAccountOwnership(
    userId: string | null | undefined,
    preferredAccountId: string | null | undefined,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!preferredAccountId) return { ok: true };
    if (!userId) {
      return { ok: false, error: 'userId required when preferredAccountId is set' };
    }
    const acc = await prisma.whatsAppAccount.findFirst({
      where: { id: preferredAccountId, userId },
      select: { id: true },
    });
    if (!acc) {
      incRegistryMetric('registry_recheck_ownership_rejected');
      logRegistryEvent('registry_recheck_ownership_rejected', {
        accountSuffix: preferredAccountId.slice(-8),
      });
      return { ok: false, error: 'WhatsApp account not found or not owned by user' };
    }
    return { ok: true };
  }

  /**
   * Enqueue recheck. One pending job per normalized phone via BullMQ jobId.
   */
  async enqueue(params: {
    phone: string;
    preferredAccountId?: string | null;
    userId?: string | null;
    reason: RegistryRecheckReason;
    skipIfFresh?: boolean;
  }): Promise<{
    outcome:
      | 'enqueued'
      | 'deduplicated'
      | 'skipped_fresh'
      | 'skipped_invalid'
      | 'rejected_ownership';
    phone?: string;
    jobId?: string;
    error?: string;
  }> {
    const phone = normalizePhone(params.phone);
    if (!phone) return { outcome: 'skipped_invalid' };

    const ownership = await this.assertAccountOwnership(params.userId, params.preferredAccountId);
    if (!ownership.ok) {
      return { outcome: 'rejected_ownership', phone, error: ownership.error };
    }

    const skipIfFresh = params.skipIfFresh !== false;
    if (skipIfFresh) {
      const fresh = await globalPhoneRegistryService.getFresh(phone);
      if (fresh?.isFresh) {
        return { outcome: 'skipped_fresh', phone };
      }
    }

    const jobId = this.jobIdForPhone(phone);
    const payload: RegistryRecheckJobPayload = {
      phone,
      preferredAccountId: params.preferredAccountId ?? null,
      userId: params.userId ?? null,
      reason: params.reason,
      enqueuedAt: new Date().toISOString(),
    };

    // BullMQ: custom jobId enforces uniqueness while job exists in queue/completed set
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'waiting' || state === 'delayed' || state === 'active' || state === 'prioritized' || state === 'waiting-children') {
          incRegistryMetric('registry_recheck_deduplicated');
          logRegistryEvent('registry_recheck_deduplicated', {
            phone: maskPhone(phone),
            state,
          });
          return { outcome: 'deduplicated', phone, jobId };
        }
        // completed/failed — remove so a new recheck can be scheduled
        try {
          await existing.remove();
        } catch {
          /* race: another worker may hold it */
        }
      }

      await this.queue.add('recheck', payload, { ...JOB_OPTS, jobId });
    } catch (err) {
      if (isDuplicateJobError(err)) {
        incRegistryMetric('registry_recheck_deduplicated');
        logRegistryEvent('registry_recheck_deduplicated', {
          phone: maskPhone(phone),
          via: 'add_race',
        });
        return { outcome: 'deduplicated', phone, jobId };
      }
      throw err;
    }

    incRegistryMetric('registry_recheck_enqueued');
    logRegistryEvent('registry_recheck_enqueued', {
      phone: maskPhone(phone),
      reason: params.reason,
      accountSuffix: params.preferredAccountId?.slice(-8) ?? null,
    });

    return { outcome: 'enqueued', phone, jobId };
  }

  async getQueueCounts() {
    return this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  }

  async close() {
    if (this._queue) {
      await this._queue.close();
      this._queue = null;
    }
  }
}

export const globalRegistryRecheckService = GlobalRegistryRecheckService.getInstance();
