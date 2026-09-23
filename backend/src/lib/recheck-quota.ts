/**
 * Redis atomic daily recheck quota (multi-host safe).
 *
 * Quota unit = **live verification attempts** (not job starts).
 * Increment only immediately before a live isRegisteredUser call.
 * Network/session failure still consumes the attempt (honest load accounting).
 *
 * Key: registry-recheck:daily:{accountId}:{UTC_YYYY-MM-DD}
 * Day boundary: UTC midnight (consistent across API/workers/DB hosts).
 */

import { getRedis } from './redis.js';
import { config } from '../config.js';
import { incRegistryMetric, logRegistryEvent } from './registry-metrics.js';

export function utcDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function recheckDailyKey(accountId: string, date = utcDateKey()): string {
  return `registry-recheck:daily:${accountId}:${date}`;
}

/** Seconds until next UTC midnight (+ small buffer) */
export function secondsUntilUtcMidnight(now = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000) + 60);
}

/**
 * Atomically try to consume one live-check slot for this account today.
 * Returns { allowed, count } where count is the value after increment if allowed,
 * or the current count if rejected.
 *
 * Lua prevents TOCTOU races across workers:
 *   INCR → if first set EXPIRE → if over limit DECR and return 0
 */
export async function tryConsumeRecheckQuota(
  accountId: string,
  limit = config.registryRecheck.dailyCapPerAccount,
): Promise<{ allowed: boolean; count: number; key: string; date: string }> {
  const date = utcDateKey();
  const key = recheckDailyKey(accountId, date);
  const ttl = secondsUntilUtcMidnight();
  const r = await getRedis();

  // EVAL: KEYS[1]=key ARGV[1]=limit ARGV[2]=ttl
  const script = `
    local n = redis.call('INCR', KEYS[1])
    if n == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[2])
    end
    if n > tonumber(ARGV[1]) then
      redis.call('DECR', KEYS[1])
      return {0, tonumber(ARGV[1])}
    end
    return {1, n}
  `;

  const result = (await r.eval(script, {
    keys: [key],
    arguments: [String(limit), String(ttl)],
  })) as [number, number];

  const allowed = Number(result[0]) === 1;
  const count = Number(result[1]);

  if (!allowed) {
    incRegistryMetric('registry_recheck_quota_rejected');
    logRegistryEvent('registry_recheck_quota_rejected', {
      accountIdSuffix: accountId.slice(-8),
      date,
      limit,
    });
  }

  return { allowed, count, key, date };
}

export async function getRecheckQuotaCount(accountId: string): Promise<number> {
  const r = await getRedis();
  const v = await r.get(recheckDailyKey(accountId));
  return v ? Number(v) : 0;
}
