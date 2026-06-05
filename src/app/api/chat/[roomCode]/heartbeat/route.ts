import { NextRequest, NextResponse } from 'next/server';
import {
  getRoom,
  isRoomExpired,
  sanitizeSenderName,
  upsertPresence,
} from '@/lib/firebase/chat';
import { isValidRoomCode, sanitizeDeviceId } from '@/lib/utils';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * POST {deviceId, senderName, typing?} — presence keep-alive.
 * Clients beat every ~25s, plus throttled typing beats (1 per ~2.5s while
 * typing). Online/typing status is derived client-side from the timestamps,
 * so going idle or closing the tab costs zero writes.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  const { roomCode } = await params;
  const code = (roomCode || '').toUpperCase();

  if (!isValidRoomCode(code)) {
    return NextResponse.json({ success: false, error: 'invalid_code' }, { status: 400 });
  }

  // ~2 keep-alives/min + typing beats — 40/min per (IP+room) has headroom.
  const rl = rateLimit(`chat:beat:${code}:${clientKey(request)}`, 40, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many heartbeats.' },
      {
        status: 429,
        headers: { 'Retry-After': Math.ceil(rl.retryAfterMs / 1000).toString() },
      }
    );
  }

  let body: { deviceId?: unknown; senderName?: unknown; typing?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const deviceId = sanitizeDeviceId(body.deviceId);
  if (!deviceId) {
    return NextResponse.json({ success: false, error: 'deviceId required' }, { status: 400 });
  }
  const senderName = sanitizeSenderName(body.senderName);
  if (senderName.length === 0) {
    return NextResponse.json({ success: false, error: 'senderName empty' }, { status: 400 });
  }
  const typing = typeof body.typing === 'boolean' ? body.typing : undefined;

  try {
    const room = await getRoom(code);
    if (!room) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }
    if (isRoomExpired(room)) {
      return NextResponse.json({ success: false, error: 'expired' }, { status: 410 });
    }

    await upsertPresence(code, { device_id: deviceId, name: senderName, typing });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Heartbeat error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}
