/**
 * GlobalRegistryRecheckWorker — production-hardened
 * - Redis atomic daily live-check quota (UTC day)
 * - Ownership: preferredAccount.userId must match job.userId
 * - No cross-tenant fallback
 * - Fresh registry → no-op (no WA call, no quota consume)
 * - Quota counts live attempts only (after eligibility, before isRegisteredUser)
 * - Infra failures never write not_on_whatsapp
 */

import { Worker, UnrecoverableError, type Job, type ConnectionOptions } from 'bullmq';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { wwbClientFactory } from '../services/WWBClientFactory.js';
import { globalPhoneRegistryService } from '../services/GlobalPhoneRegistryService.js';
import type { RegistryRecheckJobPayload } from '../services/GlobalRegistryRecheckService.js';
import { phoneVerificationService } from '../services/PhoneVerificationService.js';
import { classifyWaError } from '../lib/wa-error-classifier.js';
import { incRegistryMetric, logRegistryEvent } from '../lib/registry-metrics.js';
import { normalizePhone, maskPhone } from '../lib/phone.js';
import { tryConsumeRecheckQuota } from '../lib/recheck-quota.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function recheckSleepMs(): number {
  const min = Math.min(config.registryRecheck.sleepMinMs, config.registryRecheck.sleepMaxMs);
  const max = Math.max(config.registryRecheck.sleepMinMs, config.registryRecheck.sleepMaxMs);
  return Math.floor(min + Math.random() * (max - min + 1));
}

function isAccountEligible(status: string, riskScore: number, consecutiveProtocol: number): boolean {
  if (status !== 'ready') return false;
  if (consecutiveProtocol >= 3) return false;
  if (riskScore >= 80) return false;
  return true;
}

export class GlobalRegistryRecheckWorker {
  private worker: Worker<RegistryRecheckJobPayload> | null = null;

  start(): Worker<RegistryRecheckJobPayload> {
    if (this.worker) return this.worker;

    this.worker = new Worker<RegistryRecheckJobPayload>(
      config.registryRecheck.queueName,
      async (job) => this.process(job),
      {
        connection: config.redisConnection as ConnectionOptions,
        concurrency: config.registryRecheck.concurrency,
        lockDuration: 300_000,
      },
    );

    this.worker.on('completed', (job) => {
      logRegistryEvent('recheck_job_completed', {
        id: job.id,
        phone: maskPhone(job.data.phone),
      });
    });
    this.worker.on('failed', (job, err) => {
      incRegistryMetric('registry_recheck_failure');
      logRegistryEvent('recheck_job_failed', { id: job?.id, err: err.message });
    });

    console.log(
      `[RegistryRecheckWorker] queue=${config.registryRecheck.queueName} concurrency=${config.registryRecheck.concurrency} quota=redis-utc`,
    );
    return this.worker;
  }

  async process(job: Job<RegistryRecheckJobPayload>): Promise<{
    outcome: 'noop_fresh' | 'success' | 'deferred' | 'failed' | 'quota' | 'ownership';
    phone: string;
    onWhatsApp?: boolean;
  }> {
    const phone = normalizePhone(job.data.phone);
    if (!phone) {
      return { outcome: 'failed', phone: job.data.phone };
    }

    // Fresh already → NO live check, NO quota consume
    const cached = await globalPhoneRegistryService.getFresh(phone);
    if (cached?.isFresh) {
      incRegistryMetric('registry_recheck_noop_fresh');
      logRegistryEvent('registry_recheck_noop_fresh', { phone: maskPhone(phone) });
      return { outcome: 'noop_fresh', phone };
    }

    const preferredId = job.data.preferredAccountId;
    if (!preferredId) {
      // Permanent: never fall back to another tenant's session
      throw new UnrecoverableError('No preferredAccountId — cross-tenant fallback forbidden');
    }

    const account = await prisma.whatsAppAccount.findUnique({ where: { id: preferredId } });
    if (!account) {
      throw new UnrecoverableError(`preferredAccountId ${preferredId} not found`);
    }

    // Ownership: job.userId must own the account (when set)
    if (job.data.userId && account.userId !== job.data.userId) {
      incRegistryMetric('registry_recheck_ownership_rejected');
      logRegistryEvent('registry_recheck_ownership_rejected', {
        phone: maskPhone(phone),
        accountSuffix: preferredId.slice(-8),
      });
      // Permanent failure — do not retry and never switch accounts
      throw new UnrecoverableError('Recheck job ownership mismatch — refusing cross-tenant execution');
    }

    if (!isAccountEligible(account.status, account.riskScore, account.consecutiveProtocolFailures)) {
      incRegistryMetric('registry_recheck_account_unavailable');
      logRegistryEvent('registry_recheck_account_unavailable', {
        status: account.status,
        risk: account.riskScore,
        accountSuffix: preferredId.slice(-8),
      });
      // Retry later when account recovers
      throw new Error(
        `Account not eligible (status=${account.status} risk=${account.riskScore})`,
      );
    }

    // Atomic Redis quota — live attempts only (consume immediately before WA call)
    const quota = await tryConsumeRecheckQuota(preferredId);
    if (!quota.allowed) {
      // Do not retry immediately forever — fail job with clear reason
      // BullMQ will backoff; next day counter resets via key TTL at UTC midnight
      throw new Error(
        `Daily live-recheck quota exceeded for account (${quota.date} UTC, cap=${config.registryRecheck.dailyCapPerAccount})`,
      );
    }

    const managed = await wwbClientFactory.getOrCreate(preferredId);
    if (managed.status !== 'ready') {
      // Quota already consumed — documented: failed attempt still counts toward load budget
      throw new Error(`Account client not ready (${managed.status})`);
    }

    try {
      incRegistryMetric('registry_live_check');
      const result = await phoneVerificationService.verifyWithClient({
        phone,
        client: managed.client,
        userId: job.data.userId ?? undefined,
        sourceAccountId: preferredId,
        forceLive: true,
      });

      if (!result) {
        throw new Error('Invalid phone after normalize');
      }

      incRegistryMetric('registry_recheck_success');
      logRegistryEvent('registry_recheck_success', {
        phone: maskPhone(phone),
        onWhatsApp: result.onWhatsApp,
        reason: job.data.reason,
        quotaCount: quota.count,
      });

      await sleep(recheckSleepMs());

      return { outcome: 'success', phone, onWhatsApp: result.onWhatsApp };
    } catch (err) {
      const classified = classifyWaError(err);

      if (classified.isSessionFatal || classified.category === 'session_dead') {
        incRegistryMetric('registry_recheck_failure');
        logRegistryEvent('registry_recheck_session_error', {
          phone: maskPhone(phone),
          message: classified.message.slice(0, 200),
        });
        // NO global not_on_whatsapp
        throw err;
      }

      if (classified.category === 'not_registered') {
        await globalPhoneRegistryService.markNotOnWhatsApp(phone, preferredId);
        incRegistryMetric('registry_recheck_success');
        await sleep(recheckSleepMs());
        return { outcome: 'success', phone, onWhatsApp: false };
      }

      if (classified.category === 'target_blocked') {
        // Account-specific only — no global flip
        incRegistryMetric('registry_recheck_failure');
        logRegistryEvent('registry_recheck_blocked_account_specific', {
          phone: maskPhone(phone),
        });
        await sleep(recheckSleepMs());
        return { outcome: 'failed', phone };
      }

      // Network/unknown — retry, no global poison
      incRegistryMetric('registry_recheck_failure');
      throw err;
    }
  }

  async stop() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}

export const globalRegistryRecheckWorker = new GlobalRegistryRecheckWorker();
