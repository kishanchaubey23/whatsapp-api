import { NextResponse } from 'next/server';
import { getStatus, getError, getActiveSessionId, initialize } from '@/lib/whatsapp-client';

export async function POST(request: Request) {
  try {
    let sessionId: string | undefined;
    try {
      const body = (await request.json()) as { sessionId?: string };
      if (typeof body.sessionId === 'string' && body.sessionId.trim()) {
        sessionId = body.sessionId.trim();
      }
    } catch {
      /* no body */
    }

    const currentStatus = getStatus();
    const active = getActiveSessionId();

    if (currentStatus === 'ready' && (!sessionId || sessionId === active)) {
      return NextResponse.json({
        status: 'already_connected',
        sessionId: active,
      });
    }

    if (
      (currentStatus === 'qr' || currentStatus === 'reconnecting' || currentStatus === 'verifying') &&
      sessionId &&
      sessionId === active
    ) {
      return NextResponse.json({ status: 'initializing', sessionId: active });
    }

    initialize({ sessionId }).catch((err: Error) => {
      console.error('[WhatsApp] Initialization error:', err);
    });

    return NextResponse.json({
      status: 'initializing',
      sessionId: sessionId || getActiveSessionId(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ status: 'error', error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: getStatus(),
    error: getError(),
    sessionId: getActiveSessionId(),
  });
}
