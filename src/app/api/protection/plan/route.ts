import { NextResponse } from 'next/server';
import {
  optimizePlan,
  evaluateCampaign,
  ENTERPRISE_DEFAULTS,
  type AudienceQuality,
} from '@/lib/protection-engine';

/**
 * POST /api/protection/plan
 * Auto-build fastest enterprise-safe plan for N recipients (min time, protected).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      recipientCount?: number;
      audienceQuality?: AudienceQuality;
      accountAgeDays?: number;
      alreadySentToday?: number;
      recentRateLimitHits?: number;
      targetTier?: 'LOW' | 'MODERATE';
      dailyLimit?: number;
    };

    const recipientCount = Number(body.recipientCount ?? 0);
    if (!Number.isFinite(recipientCount) || recipientCount <= 0) {
      return NextResponse.json(
        { success: false, error: 'recipientCount must be a positive number.' },
        { status: 400 },
      );
    }

    const plan = optimizePlan(recipientCount, {
      audienceQuality: body.audienceQuality ?? 'opted_in',
      accountAgeDays: body.accountAgeDays,
      alreadySentToday: body.alreadySentToday ?? 0,
      recentRateLimitHits: body.recentRateLimitHits ?? 0,
      targetTier: body.targetTier ?? 'LOW',
      dailyLimit: body.dailyLimit ?? ENTERPRISE_DEFAULTS.dailyLimit,
    });

    const verdict = evaluateCampaign({
      recipientCount,
      delayMs: plan.delayMs,
      jitterEnabled: plan.jitterEnabled,
      batchSize: plan.batchSize,
      cooldownSeconds: plan.cooldownSeconds,
      dailyLimit: plan.dailyLimit,
      alreadySentToday: body.alreadySentToday ?? 0,
      spinEnabled: plan.spinEnabled,
      audienceQuality: body.audienceQuality ?? 'opted_in',
      accountAgeDays: body.accountAgeDays,
      recentRateLimitHits: body.recentRateLimitHits ?? 0,
    });

    return NextResponse.json({
      success: true,
      plan,
      verdict,
      enterprise: {
        priceInr: 5000,
        note: 'Enterprise protection applied to all campaigns — max safe throughput by default.',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
