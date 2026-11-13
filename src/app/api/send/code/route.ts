import { NextRequest, NextResponse } from 'next/server';
import { findReceiveSessionByCode } from '@/shared/lib/firebase/files';
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '@/shared/lib/limits';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

const CODE_RE = new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`);

/**
 * Resolve the short code shown on the PC to its session token, for phones
 * that can't scan the QR code. Body (JSON): { code }. Returns { sessionToken }.
 */
export async function POST(request: NextRequest) {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  try {
    // Tight limit: codes are short, so guessing must stay slow (10 per minute per IP).
    const rl = rateLimit(`send-code:${clientKey(request)}`, 10, 60_000);
    if (!rl.allowed) {
      return tooManyRequests('Too many tries — wait a minute and try again.', rl.retryAfterMs);
    }

    const body = await request.json().catch(() => null);
    const code =
      typeof body?.code === 'string' ? body.code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    if (!CODE_RE.test(code)) {
      return NextResponse.json(
        { success: false, error: `Enter the ${SHORT_CODE_LENGTH}-character code shown on your computer.` },
        { status: 400 }
      );
    }

    const session = await findReceiveSessionByCode(code);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'No open session with that code. Check the code or start a new session on your computer.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, sessionToken: session.session_token });
  } catch (error) {
    console.error('Send code lookup error:', error);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}
