import { NextRequest, NextResponse } from 'next/server';
import { generateToken, getRequestOrigin } from '@/shared/lib/utils';
import { currentUser } from '@/shared/lib/firebase/session';
import { createReceiveSession } from '@/shared/lib/firebase/files';

const TTL_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const sessionToken = generateToken();
    const user = await currentUser();

    await createReceiveSession({
      session_token: sessionToken,
      receiver_id: user?.uid ?? null,
      ttlMs: TTL_MS,
    });

    const sendUrl = `${getRequestOrigin(request.headers)}/send/${sessionToken}`;
    return NextResponse.json({
      success: true,
      sessionToken,
      sendUrl,
      expiresIn: Math.floor(TTL_MS / 1000),
    });
  } catch (error) {
    console.error('Create receive session error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create receive session' },
      { status: 500 }
    );
  }
}
