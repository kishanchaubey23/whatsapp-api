import { NextResponse } from 'next/server';
import { requestPairingCode, getPairingCode, getStatus } from '@/lib/whatsapp-client';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { phone?: string; sessionId?: string };
    const phone = body.phone?.trim();
    const sessionId = body.sessionId?.trim();

    if (!phone) {
      return NextResponse.json(
        { success: false, error: 'Phone number is required for pairing code' },
        { status: 400 }
      );
    }

    const code = await requestPairingCode(phone, sessionId);

    return NextResponse.json({
      success: true,
      pairingCode: code,
      status: getStatus(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, pairingCode: null, error: message },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    return NextResponse.json({
      pairingCode: getPairingCode(),
      status: getStatus(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ pairingCode: null, error: message }, { status: 500 });
  }
}
