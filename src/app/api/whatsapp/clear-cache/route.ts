import { NextResponse } from 'next/server';
import { clearAllCaches, getStatus } from '@/lib/whatsapp-client';

export async function POST(request: Request) {
  try {
    let sessionId: string | undefined;
    try {
      const body = (await request.json()) as { sessionId?: string };
      if (typeof body.sessionId === 'string') sessionId = body.sessionId;
    } catch {
      /* no body */
    }

    clearAllCaches();

    return NextResponse.json({
      success: true,
      status: getStatus(),
      sessionId: sessionId ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
