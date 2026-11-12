import { NextRequest, NextResponse } from 'next/server';
import { extendReceiveSession } from '@/shared/lib/firebase/files';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';

const EXTEND_MS = 10 * 60 * 1000;
// A session can be stretched to at most an hour after it was created.
const MAX_AGE_MS = 60 * 60 * 1000;

/** POST — give a receive session another 10 minutes (also revives a recently expired one). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionToken: string }> }
) {
  try {
    const rl = rateLimit(`receive-extend:${clientKey(request)}`, 10, 60_000);
    if (!rl.allowed) {
      return tooManyRequests('Too many requests — wait a moment and try again.', rl.retryAfterMs);
    }

    const { sessionToken } = await params;
    const result = await extendReceiveSession(sessionToken, EXTEND_MS, MAX_AGE_MS);
    if (!result.ok) {
      return result.reason === 'not_found'
        ? NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 })
        : NextResponse.json(
            { success: false, error: 'This session is over an hour old. Start a new one.' },
            { status: 410 }
          );
    }

    const expiresAt = result.session.expires_at;
    return NextResponse.json({
      success: true,
      expiresAt,
      expiresIn: Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
    });
  } catch (error) {
    console.error('Extend receive session error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
