import { NextResponse } from 'next/server';
import {
  getStatus,
  getClientInfo,
  getError,
  getProfileReport,
  getActiveSessionId,
  autoInit,
} from '@/lib/whatsapp-client';

export async function GET() {
  try {
    autoInit();

    const status = getStatus();
    const info = getClientInfo();
    const error = getError();
    const profile = getProfileReport();
    const sessionId = getActiveSessionId();

    return NextResponse.json({
      status,
      sessionId,
      ...(info ? { phone: info.wid, name: info.pushname } : {}),
      ...(error ? { error } : {}),
      ...(profile ? { profile } : {}),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ status: 'disconnected', error: message }, { status: 500 });
  }
}
