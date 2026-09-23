import { NextResponse } from 'next/server';
import {
  evaluateCampaign,
  type AudienceQuality,
  type CampaignInput,
} from '@/lib/protection-engine';

/**
 * POST /api/protection/evaluate
 * Body: campaign pacing + volume → ProtectionVerdict (tier gate + recommended plan)
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<CampaignInput> & {
      recipientCount?: number;
    };

    const recipientCount = Number(body.recipientCount ?? 0);
    if (!Number.isFinite(recipientCount) || recipientCount < 0) {
      return NextResponse.json(
        { success: false, error: 'recipientCount must be a non-negative number.' },
        { status: 400 },
      );
    }

    const input: CampaignInput = {
      recipientCount,
      delayMs: Number(body.delayMs ?? 8000),
      jitterEnabled: body.jitterEnabled !== false,
      batchSize: Number(body.batchSize ?? 15),
      cooldownSeconds: Number(body.cooldownSeconds ?? 45),
      dailyLimit: Number(body.dailyLimit ?? 800),
      alreadySentToday: Number(body.alreadySentToday ?? 0),
      spinEnabled: body.spinEnabled !== false,
      audienceQuality: (body.audienceQuality as AudienceQuality) || 'opted_in',
      accountAgeDays: body.accountAgeDays != null ? Number(body.accountAgeDays) : undefined,
      recentRateLimitHits: body.recentRateLimitHits != null ? Number(body.recentRateLimitHits) : 0,
      userApproval: Boolean(body.userApproval),
    };

    const verdict = evaluateCampaign(input);
    return NextResponse.json({ success: true, verdict });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
