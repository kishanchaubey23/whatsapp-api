/**
 * In-process metrics for GlobalPhoneRegistry + recheck queue.
 */

export type RegistryMetricKey =
  | 'registry_lookup'
  | 'registry_hit'
  | 'registry_miss'
  | 'registry_stale'
  | 'live_verification'
  | 'registry_live_check'
  | 'global_status_updated'
  | 'registry_recheck_enqueued'
  | 'registry_recheck_deduplicated'
  | 'registry_recheck_success'
  | 'registry_recheck_failure'
  | 'registry_recheck_noop_fresh'
  | 'registry_status_flip'
  | 'registry_recheck_quota_rejected'
  | 'registry_recheck_ownership_rejected'
  | 'registry_recheck_account_unavailable';

const counters: Record<RegistryMetricKey, number> = {
  registry_lookup: 0,
  registry_hit: 0,
  registry_miss: 0,
  registry_stale: 0,
  live_verification: 0,
  registry_live_check: 0,
  global_status_updated: 0,
  registry_recheck_enqueued: 0,
  registry_recheck_deduplicated: 0,
  registry_recheck_success: 0,
  registry_recheck_failure: 0,
  registry_recheck_noop_fresh: 0,
  registry_status_flip: 0,
  registry_recheck_quota_rejected: 0,
  registry_recheck_ownership_rejected: 0,
  registry_recheck_account_unavailable: 0,
};

export function incRegistryMetric(key: RegistryMetricKey, by = 1): void {
  counters[key] += by;
}

export function getRegistryMetrics(): Record<RegistryMetricKey, number> & {
  hit_rate: number;
  live_rate: number;
} {
  const lookups = counters.registry_lookup || 0;
  const hits = counters.registry_hit || 0;
  const live = counters.live_verification + counters.registry_live_check;
  return {
    ...counters,
    hit_rate: lookups === 0 ? 0 : Math.round((hits / lookups) * 1000) / 1000,
    live_rate: lookups === 0 ? 0 : Math.round((live / lookups) * 1000) / 1000,
  };
}

export function resetRegistryMetrics(): void {
  (Object.keys(counters) as RegistryMetricKey[]).forEach((k) => {
    counters[k] = 0;
  });
}

export function logRegistryEvent(event: string, extra?: Record<string, unknown>): void {
  // Prefer maskPhone in callers for phone fields — never log full MSISDN here
  console.log(`[GlobalPhoneRegistry] ${event}`, extra ? JSON.stringify(extra) : '');
}
