/**
 * Resolve spin syntax: {option1|option2|option3} → one random option per occurrence.
 * Uses single curly braces with pipes — distinct from {{Variable}} template syntax.
 * Example: "{Hi|Hello|Hey} {{Name}}!" → "Hello John!"
 */
export function resolveSpin(template: string): string {
  return template.replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_, options: string) => {
    const choices = options.split('|');
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

/** WhatsApp delay presets (ms). Turbo allows higher throughput with higher ban risk. */
export const WA_DELAY_PRESETS = {
  turbo: 2000,
  fast: 5000,
  normal: 10000,
  safe: 15000,
} as const;

export type DelayPreset = keyof typeof WA_DELAY_PRESETS | 'custom';

export const DELAY_PRESET_LABELS: Record<DelayPreset, string> = {
  turbo: 'Turbo (2s)',
  fast: 'Fast (5s)',
  normal: 'Normal (10s)',
  safe: 'Safe (15s)',
  custom: 'Custom',
};

/** Absolute bounds for custom pacing (web + extension aligned). */
export const PACING_BOUNDS = {
  delaySecMin: 1,
  delaySecMax: 120,
  batchMin: 1,
  batchMax: 100,
  cooldownSecMin: 0,
  cooldownSecMax: 600,
  dailyLimitMin: 1,
  dailyLimitMax: 5000,
} as const;

export type PacingRiskLevel = 'safe' | 'moderate' | 'aggressive' | 'critical';

export interface PacingInput {
  delayMs: number;
  jitterEnabled: boolean;
  batchSize: number;
  cooldownSeconds: number;
  dailyLimit: number;
  spinEnabled: boolean;
}

export interface PacingRisk {
  level: PacingRiskLevel;
  score: number;
  title: string;
  message: string;
  tips: string[];
  /** Rough msgs/hour ignoring cool-downs slightly underestimated */
  estimatedMsgPerHour: number;
  color: string;
  bg: string;
  border: string;
}

/**
 * Score pacing aggressiveness (0 = safest, 100 = highest block risk).
 * Used to warn users when they lower delays to send more messages.
 */
export function assessPacingRisk(input: PacingInput): PacingRisk {
  const delaySec = Math.max(0.5, input.delayMs / 1000);
  const batch = Math.max(1, input.batchSize);
  const cool = Math.max(0, input.cooldownSeconds);

  // Effective average gap including cool-down amortized over batch
  const avgGapSec = delaySec + cool / batch;
  const estimatedMsgPerHour = Math.max(1, Math.round(3600 / avgGapSec));

  let score = 0;

  // Delay weight (primary driver)
  if (delaySec < 2) score += 45;
  else if (delaySec < 4) score += 35;
  else if (delaySec < 6) score += 22;
  else if (delaySec < 10) score += 10;
  else if (delaySec < 15) score += 4;

  // Large batches without rest
  if (batch >= 50 && cool < 30) score += 20;
  else if (batch >= 25 && cool < 20) score += 14;
  else if (batch >= 15 && cool < 15) score += 8;
  else if (cool === 0 && batch > 5) score += 12;

  // Very short / zero cool-down
  if (cool === 0) score += 10;
  else if (cool < 15) score += 6;
  else if (cool < 30) score += 3;

  // High daily volume
  if (input.dailyLimit >= 1000) score += 18;
  else if (input.dailyLimit >= 500) score += 12;
  else if (input.dailyLimit >= 300) score += 6;

  // Missing humanization
  if (!input.jitterEnabled) score += 8;
  if (!input.spinEnabled) score += 5;

  score = Math.min(100, Math.round(score));

  let level: PacingRiskLevel;
  if (score >= 70) level = 'critical';
  else if (score >= 45) level = 'aggressive';
  else if (score >= 20) level = 'moderate';
  else level = 'safe';

  const meta: Record<
    PacingRiskLevel,
    { title: string; message: string; color: string; bg: string; border: string; tips: string[] }
  > = {
    safe: {
      title: 'Low block risk',
      message:
        'Pacing looks conservative. Good for business outreach while staying closer to natural sending patterns.',
      color: 'var(--green)',
      bg: 'var(--green-bg)',
      border: 'var(--green)',
      tips: ['Keep jitter and spin syntax on for best results.'],
    },
    moderate: {
      title: 'Moderate pace',
      message:
        'Faster than cautious defaults. Usually fine for opted-in contacts, but watch for delivery failures.',
      color: 'var(--amber)',
      bg: 'var(--amber-bg)',
      border: 'var(--amber)',
      tips: [
        'Prefer Normal/Safe if this is a new WhatsApp number.',
        'Only message people who opted in to your business.',
      ],
    },
    aggressive: {
      title: 'High spam / block risk',
      message:
        'Short delays or large batches can look like spam. WhatsApp may temporarily restrict or permanently ban the account.',
      color: 'var(--amber)',
      bg: 'var(--amber-bg)',
      border: 'var(--amber)',
      tips: [
        'Increase delay toward 8–15s if you see failures.',
        'Add cool-down pauses every 10–20 messages.',
        'Lower the daily limit and split campaigns across days.',
      ],
    },
    critical: {
      title: 'Very high ban risk',
      message:
        'This configuration prioritizes speed over safety. Mass-sending with little delay is a common reason WhatsApp blocks numbers. Proceed only if you accept that risk.',
      color: 'var(--red)',
      bg: 'var(--red-bg)',
      border: 'var(--red)',
      tips: [
        'Strongly recommended: switch to Normal (10s) or Safe (15s).',
        'Enable jitter + spin syntax.',
        'Never blast cold/unsolicited lists — use opted-in business contacts only.',
      ],
    },
  };

  const m = meta[level];
  return {
    level,
    score,
    title: m.title,
    message: m.message,
    tips: m.tips,
    estimatedMsgPerHour,
    color: m.color,
    bg: m.bg,
    border: m.border,
  };
}

export function resolveBaseDelayMs(preset: DelayPreset, customDelaySeconds: number): number {
  if (preset === 'custom') {
    const sec = Math.min(
      PACING_BOUNDS.delaySecMax,
      Math.max(PACING_BOUNDS.delaySecMin, customDelaySeconds),
    );
    return sec * 1000;
  }
  return WA_DELAY_PRESETS[preset];
}

/**
 * Apply random jitter to a base delay.
 * Range ≈ −30% … +50% of base. Floor is 1s (or 50% of base), so turbo/custom fast paces stay usable.
 */
export function applyJitter(baseDelayMs: number): number {
  const jitterFactor = -0.3 + Math.random() * 0.8; // −0.3 … +0.5
  const jittered = baseDelayMs * (1 + jitterFactor);
  const floor = Math.max(1000, Math.round(baseDelayMs * 0.5));
  return Math.max(floor, Math.round(jittered));
}

/** Confirm copy when user starts send on aggressive settings */
export function pacingConfirmMessage(risk: PacingRisk): string {
  return (
    `⚠️ ${risk.title}\n\n` +
    `${risk.message}\n\n` +
    `Estimated throughput: ~${risk.estimatedMsgPerHour} messages/hour.\n\n` +
    `If you spam or send too fast, WhatsApp may block your number.\n\n` +
    `Continue with these settings anyway?`
  );
}
