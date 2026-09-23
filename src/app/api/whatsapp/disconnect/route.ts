import { NextResponse } from 'next/server';
import { disconnect, getStatus } from '@/lib/whatsapp-client';

export async function POST(request: Request) {
  try {
    let clearSession = true;
    let sessionId: string | undefined;
    try {
      const body = (await request.json()) as { clearSession?: boolean; sessionId?: string };
      if (typeof body.clearSession === 'boolean') clearSession = body.clearSession;
      if (typeof body.sessionId === 'string') sessionId = body.sessionId;
    } catch {
      /* no body — default full disconnect */
    }

    await disconnect({ clearSession, sessionId });
    return NextResponse.json({
      status: getStatus(),
      clearedSession: clearSession,
      sessionId: sessionId ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    try {
      await disconnect({ clearSession: true });
    } catch {
      /* ignore */
    }
    return NextResponse.json({ status: 'disconnected', error: message }, { status: 200 });
  }
}
