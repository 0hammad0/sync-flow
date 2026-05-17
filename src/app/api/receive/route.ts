import { NextResponse } from 'next/server';
import { generateToken, getBaseUrl } from '@/lib/utils';
import { currentUser } from '@/lib/firebase/session';
import { createReceiveSession } from '@/lib/firebase/files';

const TTL_MS = 10 * 60 * 1000;

export async function POST() {
  try {
    const sessionToken = generateToken();
    const user = await currentUser();

    await createReceiveSession({
      session_token: sessionToken,
      receiver_id: user?.uid ?? null,
      ttlMs: TTL_MS,
    });

    const sendUrl = `${getBaseUrl()}/send/${sessionToken}`;
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
