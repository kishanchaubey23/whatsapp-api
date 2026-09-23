import type { ExtensionSettings } from './storage';

export const WA_DELAY_PRESETS = {
  turbo: 2000,
  fast: 5000,
  normal: 10000,
  safe: 15000,
} as const;

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

export interface PacingRisk {
  level: PacingRiskLevel;
  score: number;
  title: string;
  message: string;
  tips: string[];
  estimatedMsgPerHour: number;
  color: string;
  bg: string;
  border: string;
}

export function resolveBaseDelayMs(settings: Pick<ExtensionSettings, 'delayPreset' | 'customDelaySeconds'>): number {
  if (settings.delayPreset === 'custom') {
    const sec = Math.min(
      PACING_BOUNDS.delaySecMax,
      Math.max(PACING_BOUNDS.delaySecMin, settings.customDelaySeconds),
    );
    return sec * 1000;
  }
  return WA_DELAY_PRESETS[settings.delayPreset] ?? WA_DELAY_PRESETS.normal;
}

export function assessPacingRisk(settings: ExtensionSettings): PacingRisk {
  const delayMs = resolveBaseDelayMs(settings);
  const delaySec = Math.max(0.5, delayMs / 1000);
  const batch = Math.max(1, settings.batchSize);
  const cool = Math.max(0, settings.cooldownSeconds);
  const avgGapSec = delaySec + cool / batch;
  const estimatedMsgPerHour = Math.max(1, Math.round(3600 / avgGapSec));

  let score = 0;
  if (delaySec < 2) score += 45;
  else if (delaySec < 4) score += 35;
  else if (delaySec < 6) score += 22;
  else if (delaySec < 10) score += 10;
  else if (delaySec < 15) score += 4;

  if (batch >= 50 && cool < 30) score += 20;
  else if (batch >= 25 && cool < 20) score += 14;
  else if (batch >= 15 && cool < 15) score += 8;
  else if (cool === 0 && batch > 5) score += 12;

  if (cool === 0) score += 10;
  else if (cool < 15) score += 6;
  else if (cool < 30) score += 3;

  if (settings.dailyLimit >= 1000) score += 18;
  else if (settings.dailyLimit >= 500) score += 12;
  else if (settings.dailyLimit >= 300) score += 6;

  if (!settings.jitterEnabled) score += 8;
  if (!settings.spinSyntaxEnabled) score += 5;

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
      message: 'Pacing looks conservative for business messaging.',
      color: '#34d399',
      bg: 'rgba(52,199,89,0.12)',
      border: '#34d399',
      tips: ['Keep jitter and spin syntax enabled.'],
    },
    moderate: {
      title: 'Moderate pace',
      message: 'Faster than cautious defaults. Fine for opted-in contacts; watch failures.',
      color: '#ff9f0a',
      bg: 'rgba(255,159,10,0.12)',
      border: '#ff9f0a',
      tips: ['Use Normal/Safe on new numbers.', 'Message opted-in contacts only.'],
    },
    aggressive: {
      title: 'High spam / block risk',
      message:
        'Short delays or large batches can look like spam. WhatsApp may restrict or ban the account.',
      color: '#ff9f0a',
      bg: 'rgba(255,159,10,0.15)',
      border: '#ff9f0a',
      tips: ['Increase delay to 8–15s if issues appear.', 'Add cool-downs every 10–20 messages.'],
    },
    critical: {
      title: 'Very high ban risk',
      message:
        'Speed-first settings. Mass-sending with little delay often leads to WhatsApp blocks. Continue only if you accept that risk.',
      color: '#ff3b30',
      bg: 'rgba(255,59,48,0.12)',
      border: '#ff3b30',
      tips: [
        'Prefer Normal (10s) or Safe (15s).',
        'Enable jitter + spin.',
        'Do not send unsolicited bulk messages.',
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

export function pacingConfirmMessage(risk: PacingRisk): string {
  return (
    `⚠️ ${risk.title}\n\n` +
    `${risk.message}\n\n` +
    `~${risk.estimatedMsgPerHour} messages/hour estimated.\n\n` +
    `Spamming or sending too fast may get your WhatsApp number blocked.\n\n` +
    `Continue anyway?`
  );
}
