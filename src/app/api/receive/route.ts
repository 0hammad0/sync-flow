import { NextRequest, NextResponse } from 'next/server';
import { generateToken, getRequestOrigin } from '@/shared/lib/utils';
import { currentUser } from '@/shared/lib/firebase/session';
import { createReceiveSession } from '@/shared/lib/firebase/files';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';

const TTL_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    // Public endpoint that writes a Firestore doc — throttle (10 per minute per IP).
    const rl = rateLimit(`receive:${clientKey(request)}`, 10, 60_000);
    if (!rl.allowed) {
      return tooManyRequests('Too many new sessions — wait a moment and try again.', rl.retryAfterMs);
    }

    const sessionToken = generateToken();
    const user = await currentUser();

    const session = await createReceiveSession({
      session_token: sessionToken,
      receiver_id: user?.uid ?? null,
      ttlMs: TTL_MS,
    });

    const origin = getRequestOrigin(request.headers);
    return NextResponse.json({
      success: true,
      sessionToken,
      sendUrl: `${origin}/send/${sessionToken}`,
      // Typed at /send when the QR code can't be scanned.
      codeUrl: `${origin}/send`,
      code: session.short_code,
      expiresIn: Math.floor(TTL_MS / 1000),
      signedIn: Boolean(user),
    });
  } catch (error) {
    console.error('Create receive session error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create receive session' },
      { status: 500 }
    );
  }
}
