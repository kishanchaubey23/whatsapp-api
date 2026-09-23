/**
 * Enterprise Protection Engine (backend copy — single source for API + worker).
 * LOW allow | MODERATE warn | HIGH reduce/approve | CRITICAL block
 */

export type ProtectionTier = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type GateAction =
  | 'ALLOW'
  | 'ALLOW_WITH_WARNING'
  | 'REQUIRE_REDUCTION_OR_APPROVAL'
  | 'BLOCK';

export type AudienceQuality = 'saved_contacts' | 'opted_in' | 'mixed' | 'unknown';

export interface CampaignInput {
  recipientCount: number;
  delayMs: number;
  jitterEnabled: boolean;
  batchSize: number;
  cooldownSeconds: number;
  dailyLimit: number;
  alreadySentToday?: number;
  spinEnabled: boolean;
  audienceQuality?: AudienceQuality;
  accountAgeDays?: number;
  recentRateLimitHits?: number;
  userApproval?: boolean;
}

export interface OptimizedPlan {
  delayMs: number;
  jitterEnabled: boolean;
  batchSize: number;
  cooldownSeconds: number;
  dailyLimit: number;
  spinEnabled: boolean;
  estimatedDurationSec: number;
  msgsPerHour: number;
  tier: ProtectionTier;
  rationale: string[];
}

export interface ProtectionVerdict {
  tier: ProtectionTier;
  score: number;
  action: GateAction;
  title: string;
  message: string;
  warnings: string[];
  reductions: string[];
  recommendedPlan: OptimizedPlan;
  canProceedWithApproval: boolean;
  blocked: boolean;
  liabilityNotice: string;
}

export const ENTERPRISE_DEFAULTS = {
  delayMs: 8000,
  jitterEnabled: true,
  batchSize: 15,
  cooldownSeconds: 45,
  dailyLimit: 800,
  spinEnabled: true,
  audienceQuality: 'opted_in' as AudienceQuality,
};

const LIABILITY =
  'By continuing you accept that aggressive pacing may cause WhatsApp to restrict or ban this number. SendStack is not responsible for account blocks when you override protection.';

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function estimatedDurationSec(count: number, delayMs: number, batchSize: number, cooldownSeconds: number) {
  if (count <= 0) return 0;
  const gaps = Math.max(0, count - 1);
  const fullBatches = Math.floor(count / Math.max(1, batchSize));
  const cools = Math.max(0, fullBatches - (count % batchSize === 0 ? 1 : 0));
  return (gaps * delayMs) / 1000 + cools * cooldownSeconds;
}

function msgsPerHour(delayMs: number, batchSize: number, cooldownSeconds: number) {
  const batch = Math.max(1, batchSize);
  const avgGap = delayMs / 1000 + cooldownSeconds / batch;
  return Math.max(1, Math.round(3600 / Math.max(0.5, avgGap)));
}

export function scoreCampaign(input: CampaignInput): number {
  const delaySec = Math.max(0.5, input.delayMs / 1000);
  const batch = Math.max(1, input.batchSize);
  const cool = Math.max(0, input.cooldownSeconds);
  const n = Math.max(0, input.recipientCount);
  const sentToday = (input.alreadySentToday ?? 0) + n;

  let score = 0;
  if (delaySec < 2) score += 42;
  else if (delaySec < 4) score += 32;
  else if (delaySec < 6) score += 20;
  else if (delaySec < 8) score += 12;
  else if (delaySec < 10) score += 6;
  else if (delaySec < 12) score += 2;

  if (cool === 0 && batch > 8) score += 14;
  else if (cool < 20 && batch >= 25) score += 12;
  else if (cool < 30 && batch >= 20) score += 8;
  else if (cool < 15) score += 5;

  if (n >= 2000) score += 22;
  else if (n >= 1000) score += 16;
  else if (n >= 500) score += 10;
  else if (n >= 200) score += 5;

  if (sentToday >= 1500) score += 18;
  else if (sentToday >= 800) score += 10;
  else if (sentToday >= 400) score += 5;

  if (input.dailyLimit >= 2000) score += 12;
  else if (input.dailyLimit >= 1000) score += 6;

  if (!input.jitterEnabled) score += 7;
  if (!input.spinEnabled) score += 5;

  const age = input.accountAgeDays ?? 30;
  if (age < 7) score += 15;
  else if (age < 21) score += 8;

  const rl = input.recentRateLimitHits ?? 0;
  if (rl >= 3) score += 20;
  else if (rl >= 1) score += 10;

  const aq = input.audienceQuality ?? 'unknown';
  if (aq === 'saved_contacts') score -= 8;
  else if (aq === 'opted_in') score -= 6;
  else if (aq === 'mixed') score -= 2;
  else score += 4;

  return clamp(Math.round(score), 0, 100);
}

export function tierFromScore(score: number): ProtectionTier {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MODERATE';
  return 'LOW';
}

export function optimizePlan(
  recipientCount: number,
  opts?: {
    audienceQuality?: AudienceQuality;
    alreadySentToday?: number;
    dailyLimit?: number;
    targetTier?: 'LOW' | 'MODERATE';
  },
): OptimizedPlan {
  const audienceQuality = opts?.audienceQuality ?? 'opted_in';
  const alreadySentToday = opts?.alreadySentToday ?? 0;
  const dailyLimit = opts?.dailyLimit ?? ENTERPRISE_DEFAULTS.dailyLimit;
  const delays = [5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000, 18000, 22000];
  const batches = [20, 15, 12, 10, 8];
  const cooldowns = [30, 45, 60, 90, 120];

  let best: OptimizedPlan | null = null;
  let bestMod: OptimizedPlan | null = null;

  for (const delayMs of delays) {
    for (const batchSize of batches) {
      for (const cooldownSeconds of cooldowns) {
        const score = scoreCampaign({
          recipientCount,
          delayMs,
          jitterEnabled: true,
          batchSize,
          cooldownSeconds,
          dailyLimit,
          alreadySentToday,
          spinEnabled: true,
          audienceQuality,
        });
        const tier = tierFromScore(score);
        const plan: OptimizedPlan = {
          delayMs,
          jitterEnabled: true,
          batchSize,
          cooldownSeconds,
          dailyLimit,
          spinEnabled: true,
          estimatedDurationSec: estimatedDurationSec(recipientCount, delayMs, batchSize, cooldownSeconds),
          msgsPerHour: msgsPerHour(delayMs, batchSize, cooldownSeconds),
          tier,
          rationale: [],
        };
        if (tier === 'LOW' && (!best || plan.estimatedDurationSec < best.estimatedDurationSec)) best = plan;
        if (tier === 'MODERATE' && (!bestMod || plan.estimatedDurationSec < bestMod.estimatedDurationSec)) bestMod = plan;
      }
    }
  }

  const chosen = (opts?.targetTier ?? 'LOW') === 'LOW' ? best ?? bestMod : bestMod ?? best;
  if (!chosen) {
    return {
      delayMs: 15000,
      jitterEnabled: true,
      batchSize: 8,
      cooldownSeconds: 120,
      dailyLimit,
      spinEnabled: true,
      estimatedDurationSec: estimatedDurationSec(recipientCount, 15000, 8, 120),
      msgsPerHour: msgsPerHour(15000, 8, 120),
      tier: 'LOW',
      rationale: ['Fallback safe plan'],
    };
  }
  chosen.rationale = [
    `Auto-tuned for ${recipientCount} recipients`,
    `Tier ${chosen.tier}: ~${chosen.msgsPerHour} msg/hr`,
  ];
  return chosen;
}

export function evaluateCampaign(input: CampaignInput): ProtectionVerdict {
  const score = scoreCampaign(input);
  const tier = tierFromScore(score);
  const recommendedPlan = optimizePlan(input.recipientCount, {
    audienceQuality: input.audienceQuality,
    alreadySentToday: input.alreadySentToday,
    dailyLimit: input.dailyLimit > 0 ? input.dailyLimit : ENTERPRISE_DEFAULTS.dailyLimit,
  });

  let action: GateAction;
  if (tier === 'LOW') action = 'ALLOW';
  else if (tier === 'MODERATE') action = 'ALLOW_WITH_WARNING';
  else if (tier === 'HIGH') action = input.userApproval ? 'ALLOW_WITH_WARNING' : 'REQUIRE_REDUCTION_OR_APPROVAL';
  else action = 'BLOCK';

  const blocked = tier === 'CRITICAL' || action === 'BLOCK';

  const titles: Record<ProtectionTier, string> = {
    LOW: 'Protected — good to send',
    MODERATE: 'Acceptable pace — mild warning',
    HIGH: 'High risk — reduce or approve',
    CRITICAL: 'Campaign blocked',
  };

  const messages: Record<ProtectionTier, string> = {
    LOW: 'Inside enterprise safe band — max safe throughput.',
    MODERATE: 'Allowed with warning for real business lists.',
    HIGH: 'Too aggressive. Apply recommended plan or approve liability.',
    CRITICAL: 'Unsafe volume/pace. Campaign blocked.',
  };

  return {
    tier,
    score,
    action,
    title: titles[tier],
    message: messages[tier],
    warnings: tier === 'HIGH' || tier === 'CRITICAL' ? [LIABILITY] : [],
    reductions: [
      `Use ≥${(recommendedPlan.delayMs / 1000).toFixed(0)}s delay`,
      `Batch ≤${recommendedPlan.batchSize}`,
      `Cool-down ≥${recommendedPlan.cooldownSeconds}s`,
    ],
    recommendedPlan,
    canProceedWithApproval: tier === 'HIGH' && !input.userApproval,
    blocked,
    liabilityNotice: LIABILITY,
  };
}

export function nextDelayMs(params: {
  baseDelayMs: number;
  jitterEnabled: boolean;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  rateLimitHitsSession: number;
  progressRatio?: number;
}): number {
  let delay = params.baseDelayMs;
  if (params.consecutiveSuccesses >= 20 && params.rateLimitHitsSession === 0) delay *= 0.9;
  else if (params.consecutiveSuccesses >= 10 && params.rateLimitHitsSession === 0) delay *= 0.95;
  if (params.rateLimitHitsSession > 0) delay += Math.min(60000, params.rateLimitHitsSession * 8000);
  if (params.consecutiveFailures >= 2) delay *= 1.25;
  if (params.consecutiveFailures >= 5) delay *= 1.5;
  if ((params.progressRatio ?? 0) > 0.7) delay *= 1.05;
  delay = clamp(delay, 2000, 120000);
  if (!params.jitterEnabled) return Math.round(delay);
  const factor = -0.25 + Math.random() * 0.7;
  const floor = Math.max(2000, Math.round(delay * 0.55));
  return Math.max(floor, Math.round(delay * (1 + factor)));
}

/** Runtime ban-risk events from MessageWorker exception interceptors */
export type RuntimeRiskEvent =
  | 'target_blocked'
  | 'session_dead'
  | 'session_banned'
  | 'rate_limited'
  | 'not_registered'
  | 'send_success'
  | 'verify_success'
  | 'unknown_error';

export type RuntimeRiskState = {
  score: number;
  tier: ProtectionTier;
  consecutiveProtocolFailures: number;
  consecutiveTargetBlocks: number;
  lastEvent: RuntimeRiskEvent | null;
  killSwitch: boolean;
};

const RISK_DELTAS: Record<RuntimeRiskEvent, number> = {
  target_blocked: 4,
  session_dead: 28,
  session_banned: 45,
  rate_limited: 14,
  not_registered: 1,
  send_success: -2,
  verify_success: -1,
  unknown_error: 3,
};

/** Apply a worker runtime event to an in-memory risk tracker (per whatsappAccountId). */
export function applyRuntimeRiskEvent(
  prev: RuntimeRiskState | null | undefined,
  event: RuntimeRiskEvent,
  opts?: { consecutiveProtocolThreshold?: number },
): RuntimeRiskState {
  const threshold = opts?.consecutiveProtocolThreshold ?? 3;
  const base: RuntimeRiskState = prev ?? {
    score: 0,
    tier: 'LOW',
    consecutiveProtocolFailures: 0,
    consecutiveTargetBlocks: 0,
    lastEvent: null,
    killSwitch: false,
  };

  let score = clamp(base.score + RISK_DELTAS[event], 0, 100);
  let consecutiveProtocolFailures = base.consecutiveProtocolFailures;
  let consecutiveTargetBlocks = base.consecutiveTargetBlocks;
  let killSwitch = base.killSwitch;

  if (event === 'session_dead' || event === 'session_banned') {
    consecutiveProtocolFailures += 1;
    consecutiveTargetBlocks = 0;
    if (consecutiveProtocolFailures >= threshold || event === 'session_banned') {
      killSwitch = true;
      score = Math.max(score, event === 'session_banned' ? 90 : 80);
    }
  } else if (event === 'target_blocked') {
    consecutiveTargetBlocks += 1;
    consecutiveProtocolFailures = 0; // contact-level — does not count toward session kill
  } else if (event === 'send_success' || event === 'verify_success') {
    consecutiveProtocolFailures = 0;
    consecutiveTargetBlocks = 0;
  } else if (event === 'rate_limited') {
    consecutiveProtocolFailures = 0;
  }

  return {
    score,
    tier: tierFromScore(score),
    consecutiveProtocolFailures,
    consecutiveTargetBlocks,
    lastEvent: event,
    killSwitch,
  };
}

export function riskEventFromCategory(
  category: string,
  message?: string,
): RuntimeRiskEvent {
  if (category === 'target_blocked') return 'target_blocked';
  if (category === 'session_dead') {
    return message && /banned|suspended/i.test(message) ? 'session_banned' : 'session_dead';
  }
  if (category === 'rate_limited') return 'rate_limited';
  if (category === 'not_registered') return 'not_registered';
  return 'unknown_error';
}
