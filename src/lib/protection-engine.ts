/**
 * Enterprise Protection Engine
 * ----------------------------
 * Goal: deliver every business message as fast as safely possible, while
 * reducing ban risk for real opted-in / contact-list outreach (not spam).
 *
 * Gate:
 *   LOW      → Allow
 *   MODERATE → Allow + warning
 *   HIGH     → Require reduction OR explicit user approval (liability on user)
 *   CRITICAL → Block campaign (no send)
 *
 * Plan ₹5000 enterprise: same protection for all tenants; throughput is
 * maximized inside LOW/MODERATE by default. Faster only with approval.
 */

export type ProtectionTier = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export type GateAction =
  | 'ALLOW'
  | 'ALLOW_WITH_WARNING'
  | 'REQUIRE_REDUCTION_OR_APPROVAL'
  | 'BLOCK';

/** How the sender relates to recipients (business context, not spam). */
export type AudienceQuality =
  | 'saved_contacts' // in phone book / known customers
  | 'opted_in' // form, purchase, lead — consented
  | 'mixed' // some known, some cold-ish
  | 'unknown'; // user did not classify

export interface CampaignInput {
  /** Total recipients in this campaign */
  recipientCount: number;
  /** Base delay between messages (ms) */
  delayMs: number;
  /** Randomize delays */
  jitterEnabled: boolean;
  /** Messages per batch before cool-down */
  batchSize: number;
  /** Cool-down length (seconds); 0 = none */
  cooldownSeconds: number;
  /** Soft daily cap */
  dailyLimit: number;
  /** Already sent today (this account) */
  alreadySentToday?: number;
  /** Spin / template variation */
  spinEnabled: boolean;
  /** Audience quality — businesses with real contacts get slight trust */
  audienceQuality?: AudienceQuality;
  /** Account age days if known (new numbers are stricter) */
  accountAgeDays?: number;
  /** Recent rate-limit / ban signals in last 24h */
  recentRateLimitHits?: number;
  /** User already accepted HIGH-tier liability */
  userApproval?: boolean;
}

export interface OptimizedPlan {
  delayMs: number;
  jitterEnabled: boolean;
  batchSize: number;
  cooldownSeconds: number;
  dailyLimit: number;
  spinEnabled: boolean;
  /** Estimated wall-clock for full campaign (seconds) */
  estimatedDurationSec: number;
  /** Approx msgs/hour under this plan */
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
  /** Fastest plan that still lands in LOW (or MODERATE if volume forces it) */
  recommendedPlan: OptimizedPlan;
  /** If current input is HIGH and user approves, effective action becomes ALLOW_WITH_WARNING */
  canProceedWithApproval: boolean;
  blocked: boolean;
  /** Liability line when approval path is used */
  liabilityNotice: string;
}

const LIABILITY =
  'By continuing you accept that aggressive pacing may cause WhatsApp to restrict or ban this number. SendStack is not responsible for account blocks when you override protection.';

/** Enterprise defaults: max safe speed for real business bulk. */
export const ENTERPRISE_DEFAULTS = {
  delayMs: 8000,
  jitterEnabled: true,
  batchSize: 15,
  cooldownSeconds: 45,
  dailyLimit: 800,
  spinEnabled: true,
  audienceQuality: 'opted_in' as AudienceQuality,
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function estimatedDurationSec(
  count: number,
  delayMs: number,
  batchSize: number,
  cooldownSeconds: number,
): number {
  if (count <= 0) return 0;
  const gaps = Math.max(0, count - 1);
  const fullBatches = Math.floor(count / Math.max(1, batchSize));
  // cool-downs after each full batch except possibly trailing incomplete
  const cools = Math.max(0, fullBatches - (count % batchSize === 0 ? 1 : 0));
  return (gaps * delayMs) / 1000 + cools * cooldownSeconds;
}

function msgsPerHour(delayMs: number, batchSize: number, cooldownSeconds: number): number {
  const batch = Math.max(1, batchSize);
  const avgGap = delayMs / 1000 + cooldownSeconds / batch;
  return Math.max(1, Math.round(3600 / Math.max(0.5, avgGap)));
}

/**
 * Score 0–100 (higher = riskier). Tuned for business bulk, not cold spam.
 * Saved/opted-in audiences get a mild trust discount.
 */
export function scoreCampaign(input: CampaignInput): number {
  const delaySec = Math.max(0.5, input.delayMs / 1000);
  const batch = Math.max(1, input.batchSize);
  const cool = Math.max(0, input.cooldownSeconds);
  const n = Math.max(0, input.recipientCount);
  const sentToday = (input.alreadySentToday ?? 0) + n;

  let score = 0;

  // --- Pace ---
  if (delaySec < 2) score += 42;
  else if (delaySec < 4) score += 32;
  else if (delaySec < 6) score += 20;
  else if (delaySec < 8) score += 12;
  else if (delaySec < 10) score += 6;
  else if (delaySec < 12) score += 2;

  // Burst without rest
  if (cool === 0 && batch > 8) score += 14;
  else if (cool < 20 && batch >= 25) score += 12;
  else if (cool < 30 && batch >= 20) score += 8;
  else if (cool < 15) score += 5;

  // Volume pressure (same day)
  if (n >= 2000) score += 22;
  else if (n >= 1000) score += 16;
  else if (n >= 500) score += 10;
  else if (n >= 200) score += 5;

  if (sentToday >= 1500) score += 18;
  else if (sentToday >= 800) score += 10;
  else if (sentToday >= 400) score += 5;

  if (input.dailyLimit >= 2000) score += 12;
  else if (input.dailyLimit >= 1000) score += 6;

  // Humanization missing
  if (!input.jitterEnabled) score += 7;
  if (!input.spinEnabled) score += 5;

  // Account / history
  const age = input.accountAgeDays ?? 30;
  if (age < 7) score += 15;
  else if (age < 21) score += 8;

  const rl = input.recentRateLimitHits ?? 0;
  if (rl >= 3) score += 20;
  else if (rl >= 1) score += 10;

  // Audience trust (real business contacts)
  const aq = input.audienceQuality ?? 'unknown';
  if (aq === 'saved_contacts') score -= 8;
  else if (aq === 'opted_in') score -= 6;
  else if (aq === 'mixed') score -= 2;
  else score += 4; // unknown cold-ish

  return clamp(Math.round(score), 0, 100);
}

export function tierFromScore(score: number): ProtectionTier {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MODERATE';
  return 'LOW';
}

function actionForTier(tier: ProtectionTier, userApproval: boolean): GateAction {
  switch (tier) {
    case 'LOW':
      return 'ALLOW';
    case 'MODERATE':
      return 'ALLOW_WITH_WARNING';
    case 'HIGH':
      return userApproval ? 'ALLOW_WITH_WARNING' : 'REQUIRE_REDUCTION_OR_APPROVAL';
    case 'CRITICAL':
      return 'BLOCK';
  }
}

/**
 * Build the fastest plan that stays at or under target tier.
 * Prefer LOW; if volume makes LOW impossible, settle for MODERATE.
 */
export function optimizePlan(
  recipientCount: number,
  opts?: {
    audienceQuality?: AudienceQuality;
    accountAgeDays?: number;
    alreadySentToday?: number;
    recentRateLimitHits?: number;
    targetTier?: 'LOW' | 'MODERATE';
    dailyLimit?: number;
  },
): OptimizedPlan {
  const target = opts?.targetTier ?? 'LOW';
  const audienceQuality = opts?.audienceQuality ?? 'opted_in';
  const alreadySentToday = opts?.alreadySentToday ?? 0;
  const accountAgeDays = opts?.accountAgeDays ?? 30;
  const recentRateLimitHits = opts?.recentRateLimitHits ?? 0;
  const dailyLimit = opts?.dailyLimit ?? ENTERPRISE_DEFAULTS.dailyLimit;

  // Search grid: delay ascending (faster first), then batch/cooldown
  const delays = [5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000, 18000, 22000];
  const batches = [20, 15, 12, 10, 8];
  const cooldowns = [30, 45, 60, 90, 120];

  let best: OptimizedPlan | null = null;
  let bestMod: OptimizedPlan | null = null;

  for (const delayMs of delays) {
    for (const batchSize of batches) {
      for (const cooldownSeconds of cooldowns) {
        const candidate: CampaignInput = {
          recipientCount,
          delayMs,
          jitterEnabled: true,
          batchSize,
          cooldownSeconds,
          dailyLimit,
          alreadySentToday,
          spinEnabled: true,
          audienceQuality,
          accountAgeDays,
          recentRateLimitHits,
        };
        const score = scoreCampaign(candidate);
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

        if (tier === 'LOW') {
          if (!best || plan.estimatedDurationSec < best.estimatedDurationSec) best = plan;
        } else if (tier === 'MODERATE') {
          if (!bestMod || plan.estimatedDurationSec < bestMod.estimatedDurationSec) bestMod = plan;
        }
      }
    }
  }

  const chosen =
    target === 'LOW'
      ? best ?? bestMod
      : bestMod ?? best;

  if (!chosen) {
    // Fallback ultra-safe
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
      rationale: [
        'Fallback safe plan — high volume or weak account signals.',
        'Jitter + spin enabled for natural variation.',
      ],
    };
  }

  chosen.rationale = [
    `Auto-tuned for ${recipientCount} recipients at minimum safe time.`,
    `Tier ${chosen.tier}: ~${chosen.msgsPerHour} msg/hr, ~${Math.ceil(chosen.estimatedDurationSec / 60)} min total.`,
    'Jitter and spin kept on so bulk looks less robotic.',
    audienceQuality === 'saved_contacts' || audienceQuality === 'opted_in'
      ? 'Audience marked as real business contacts — mild trust applied.'
      : 'Classify audience as opted-in/saved contacts for better throughput.',
  ];

  return chosen;
}

function reductionsFor(input: CampaignInput, recommended: OptimizedPlan): string[] {
  const tips: string[] = [];
  if (input.delayMs < recommended.delayMs) {
    tips.push(`Increase delay to ≥ ${(recommended.delayMs / 1000).toFixed(0)}s (recommended).`);
  }
  if (input.batchSize > recommended.batchSize) {
    tips.push(`Reduce batch size to ≤ ${recommended.batchSize}.`);
  }
  if (input.cooldownSeconds < recommended.cooldownSeconds) {
    tips.push(`Increase cool-down to ≥ ${recommended.cooldownSeconds}s.`);
  }
  if (!input.jitterEnabled) tips.push('Turn on random jitter.');
  if (!input.spinEnabled) tips.push('Enable message spin / variation.');
  if ((input.alreadySentToday ?? 0) + input.recipientCount > recommended.dailyLimit) {
    tips.push(`Split campaign: daily soft cap ~${recommended.dailyLimit} for this plan.`);
  }
  if (tips.length === 0) {
    tips.push('Apply the recommended enterprise plan to minimize time under protection.');
  }
  return tips;
}

/**
 * Full gate evaluation for a configured campaign.
 */
export function evaluateCampaign(input: CampaignInput): ProtectionVerdict {
  const score = scoreCampaign(input);
  const tier = tierFromScore(score);
  const recommendedPlan = optimizePlan(input.recipientCount, {
    audienceQuality: input.audienceQuality,
    accountAgeDays: input.accountAgeDays,
    alreadySentToday: input.alreadySentToday,
    recentRateLimitHits: input.recentRateLimitHits,
    dailyLimit: input.dailyLimit > 0 ? input.dailyLimit : ENTERPRISE_DEFAULTS.dailyLimit,
    targetTier: 'LOW',
  });

  const userApproval = Boolean(input.userApproval);
  let action = actionForTier(tier, userApproval);

  // HIGH + approval → allow with warning (user owns ban risk)
  if (tier === 'HIGH' && userApproval) {
    action = 'ALLOW_WITH_WARNING';
  }

  const blocked = action === 'BLOCK' || tier === 'CRITICAL';
  const canProceedWithApproval = tier === 'HIGH' && !userApproval;

  const titles: Record<ProtectionTier, string> = {
    LOW: 'Protected — good to send',
    MODERATE: 'Acceptable pace — mild warning',
    HIGH: 'High risk — reduce or approve',
    CRITICAL: 'Campaign blocked',
  };

  const messages: Record<ProtectionTier, string> = {
    LOW: 'Pacing is inside the enterprise safe band. Optimized for delivery to all recipients with low ban pressure.',
    MODERATE:
      'Faster or larger than ideal. Allowed for real business lists. Watch failures; engine may slow on rate-limits.',
    HIGH: 'Too aggressive for automatic send. Apply recommended reductions, or explicitly approve and accept ban liability.',
    CRITICAL:
      'Settings or volume are unsafe (spam-like or account already stressed). Campaign is blocked. Apply the recommended plan or split the list.',
  };

  const warnings: string[] = [];
  if (tier === 'MODERATE' || tier === 'HIGH') {
    warnings.push(
      'WhatsApp may still limit accounts that message cold numbers or identical text at high speed.',
    );
  }
  if ((input.recentRateLimitHits ?? 0) > 0) {
    warnings.push('Recent rate-limit signals detected — prefer recommended plan today.');
  }
  if ((input.accountAgeDays ?? 30) < 14) {
    warnings.push('New WhatsApp numbers should stay slower for the first 2 weeks.');
  }
  if (tier === 'HIGH' || tier === 'CRITICAL') {
    warnings.push(LIABILITY);
  }

  return {
    tier,
    score,
    action,
    title: titles[tier],
    message: messages[tier],
    warnings,
    reductions: reductionsFor(input, recommendedPlan),
    recommendedPlan,
    canProceedWithApproval,
    blocked,
    liabilityNotice: LIABILITY,
  };
}

/**
 * Adaptive wait before next message.
 * Speeds up slightly after healthy streak; backs off on rate-limit / errors.
 * Keeps delivery moving for every number while protecting the session.
 */
export function nextDelayMs(params: {
  baseDelayMs: number;
  jitterEnabled: boolean;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  rateLimitHitsSession: number;
  /** 0–1 progress through campaign */
  progressRatio?: number;
}): number {
  let delay = params.baseDelayMs;

  // Mild speed-up after stable successes (business bulk efficiency)
  if (params.consecutiveSuccesses >= 20 && params.rateLimitHitsSession === 0) {
    delay *= 0.9;
  } else if (params.consecutiveSuccesses >= 10 && params.rateLimitHitsSession === 0) {
    delay *= 0.95;
  }

  // Back off on trouble
  if (params.rateLimitHitsSession > 0) {
    delay += Math.min(60000, params.rateLimitHitsSession * 8000);
  }
  if (params.consecutiveFailures >= 2) {
    delay *= 1.25;
  }
  if (params.consecutiveFailures >= 5) {
    delay *= 1.5;
  }

  // Late-campaign slight ease (long runs look more bot-like)
  if ((params.progressRatio ?? 0) > 0.7) {
    delay *= 1.05;
  }

  delay = clamp(delay, 2000, 120000);

  if (!params.jitterEnabled) return Math.round(delay);

  const factor = -0.25 + Math.random() * 0.7; // −25% … +45%
  const jittered = delay * (1 + factor);
  const floor = Math.max(2000, Math.round(delay * 0.55));
  return Math.max(floor, Math.round(jittered));
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
