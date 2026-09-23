/**
 * QueueService — BullMQ ingestion + batch status tracking
 * -------------------------------------------------------
 * Express stays non-blocking: persist batch → segment phones → enqueue jobs.
 * Workers consume `wa-blast-jobs` with anti-ban pacing.
 */

import { Queue, QueueEvents, type JobsOptions } from 'bullmq';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import type { BlastJobKind } from '@prisma/client';

export type BlastJobPayload = {
  batchId: string;
  userId: string;
  whatsappAccountId: string;
  kind: BlastJobKind;
  messageBody?: string | null;
  /** Segment of phones for this job (E.164 digits, no +) */
  phones: string[];
  chunkIndex: number;
  chunkTotal: number;
};

export type IngestBlastInput = {
  userId: string;
  whatsappAccountId: string;
  kind?: BlastJobKind;
  messageBody?: string;
  phones: string[];
  /** Optional human label */
  name?: string;
};

const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-\(\)\+]/g, '');
  if (!/^\d{7,15}$/.test(digits)) return null;
  return digits;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export class QueueService {
  private static instance: QueueService | null = null;

  readonly queue: Queue<BlastJobPayload>;
  readonly events: QueueEvents;

  private constructor() {
    const connection = config.redisConnection;
    this.queue = new Queue<BlastJobPayload>(config.queueName, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
    this.events = new QueueEvents(config.queueName, { connection });
  }

  static getInstance(): QueueService {
    if (!QueueService.instance) QueueService.instance = new QueueService();
    return QueueService.instance;
  }

  /**
   * API entry: validate ownership, save batch, split phones, push to BullMQ.
   * Returns immediately with batch id + job ids — no WA work on the request thread.
   */
  async ingestBlast(input: IngestBlastInput) {
    const kind = input.kind ?? 'verify_and_send';
    if (kind !== 'verify' && !input.messageBody?.trim()) {
      throw Object.assign(new Error('messageBody is required for send jobs'), { status: 400 });
    }

    const account = await prisma.whatsAppAccount.findFirst({
      where: { id: input.whatsappAccountId, userId: input.userId },
    });
    if (!account) {
      throw Object.assign(new Error('WhatsApp account not found'), { status: 404 });
    }
    if (account.status !== 'ready') {
      throw Object.assign(
        new Error(`WhatsApp account is not ready (status=${account.status}). Link QR first.`),
        { status: 409 },
      );
    }

    const seen = new Set<string>();
    const phones: string[] = [];
    for (const raw of input.phones) {
      const n = normalizePhone(raw);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      phones.push(n);
      if (phones.length >= config.maxBatchSize) break;
    }

    if (phones.length === 0) {
      throw Object.assign(new Error('No valid phone numbers in payload'), { status: 400 });
    }

    const chunks = chunkArray(phones, config.queueChunkSize);
    const batch = await prisma.blastBatch.create({
      data: {
        userId: input.userId,
        whatsappAccountId: input.whatsappAccountId,
        kind,
        status: 'queued',
        messageBody: input.messageBody?.trim() || null,
        totalNumbers: phones.length,
        payload: {
          name: input.name ?? null,
          phoneCount: phones.length,
          chunkTotal: chunks.length,
        },
      },
    });

    const jobIds: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const payload: BlastJobPayload = {
        batchId: batch.id,
        userId: input.userId,
        whatsappAccountId: input.whatsappAccountId,
        kind,
        messageBody: input.messageBody?.trim() || null,
        phones: chunks[i],
        chunkIndex: i,
        chunkTotal: chunks.length,
      };

      // Serialize work per WhatsApp account so one residential IP isn't burst-loaded
      const job = await this.queue.add(`blast:${batch.id}:${i}`, payload, {
        ...DEFAULT_JOB_OPTS,
        jobId: `${batch.id}_${i}`,
        // Same account jobs share a group name for observability; concurrency still limited on worker
      });
      if (job.id) jobIds.push(String(job.id));
    }

    await prisma.blastBatch.update({
      where: { id: batch.id },
      data: { bullJobId: jobIds[0] ?? null },
    });

    return {
      batchId: batch.id,
      totalNumbers: phones.length,
      chunks: chunks.length,
      jobIds,
      status: 'queued' as const,
    };
  }

  async getBatchStatus(userId: string, batchId: string) {
    const batch = await prisma.blastBatch.findFirst({
      where: { id: batchId, userId },
      include: {
        whatsappAccount: {
          select: { id: true, label: true, phone: true, status: true },
        },
      },
    });
    if (!batch) return null;

    const waiting = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return {
      batch,
      queueCounts: waiting,
    };
  }

  async cancelBatch(userId: string, batchId: string, status: 'cancelled' | 'paused' = 'cancelled') {
    const batch = await prisma.blastBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) return null;

    // Remove pending chunk jobs (do not interrupt the currently active job mid-number —
    // the worker checks batch.status and exits the loop)
    for (let i = 0; i < 10_000; i++) {
      const job = await this.queue.getJob(`${batchId}_${i}`);
      if (!job) {
        if (i > 0) break;
        continue;
      }
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
      }
    }

    return prisma.blastBatch.update({
      where: { id: batchId },
      data: { status, completedAt: new Date() },
    });
  }

  /** Kill remaining chunks for a batch (used by session kill-switch; userId already trusted). */
  async abortBatchJobs(batchId: string) {
    for (let i = 0; i < 10_000; i++) {
      const job = await this.queue.getJob(`${batchId}_${i}`);
      if (!job) {
        if (i > 0) break;
        continue;
      }
      try {
        const state = await job.getState();
        if (state === 'waiting' || state === 'delayed' || state === 'active') {
          await job.remove();
        }
      } catch {
        /* ignore */
      }
    }
  }

  async close() {
    await this.events.close();
    await this.queue.close();
  }
}

export const queueService = QueueService.getInstance();
