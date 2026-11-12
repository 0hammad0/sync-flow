import { NextRequest, NextResponse } from 'next/server';
import { extendRoom, getRoom, isRoomExpired } from '@/shared/lib/firebase/chat';
import { currentUser } from '@/shared/lib/firebase/session';
import { isValidRoomCode } from '@/shared/lib/utils';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  const { roomCode } = await params;
  const code = (roomCode || '').toUpperCase();

  if (!isValidRoomCode(code)) {
    return NextResponse.json(
      { success: false, error: 'invalid_code' },
      { status: 400 }
    );
  }

  try {
    const room = await getRoom(code);
    if (!room) {
      return NextResponse.json(
        { success: false, error: 'not_found' },
        { status: 404 }
      );
    }
    if (isRoomExpired(room)) {
      return NextResponse.json(
        { success: false, error: 'expired' },
        { status: 410 }
      );
    }
    return NextResponse.json({ success: true, room });
  } catch (err) {
    console.error('Get room error:', err);
    return NextResponse.json(
      { success: false, error: 'unexpected' },
      { status: 500 }
    );
  }
}

const EXTEND_STATUS = {
  not_found: 404,
  expired: 410,
  anonymous_room: 403,
  not_owner: 403,
  at_max: 409,
} as const;

/**
 * PATCH {action: 'extend'} — owner-only: add 24h to the room's expiry,
 * capped at 7 days from creation. Ownership is the signed-in session's uid
 * against the room's `created_by`; rooms made by guests can't be extended.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  const { roomCode } = await params;
  const code = (roomCode || '').toUpperCase();

  if (!isValidRoomCode(code)) {
    return NextResponse.json({ success: false, error: 'invalid_code' }, { status: 400 });
  }

  const rl = rateLimit(`chat:extend:${clientKey(request)}`, 10, 60_000);
  if (!rl.allowed) return tooManyRequests('rate_limited', rl.retryAfterMs);

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.action !== 'extend') {
    return NextResponse.json({ success: false, error: 'unknown_action' }, { status: 400 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'not_signed_in' }, { status: 401 });
  }

  try {
    const result = await extendRoom(code, user.uid);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.reason },
        { status: EXTEND_STATUS[result.reason] }
      );
    }
    return NextResponse.json({ success: true, expiresAt: result.expires_at });
  } catch (err) {
    console.error('Extend room error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}
