import { NextRequest, NextResponse } from 'next/server';
import { getRoom, isRoomExpired, markVoicePlayed } from '@/shared/lib/firebase/chat';
import { deviceKey } from '@/server/device-key';
import { isValidMessageId, isValidRoomCode } from '@/shared/lib/utils';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

export const runtime = 'nodejs';

/**
 * POST {messageId, deviceId} — mark a voice note as played by this device.
 * The sender then sees the "played" mic colour, WhatsApp-style. Idempotent:
 * playing the same note again changes nothing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  const { roomCode } = await params;
  const code = (roomCode || '').toUpperCase();
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ success: false, error: 'invalid_code' }, { status: 400 });
  }

  const rl = rateLimit(`chat:played:${code}:${clientKey(request)}`, 60, 60_000);
  if (!rl.allowed) return tooManyRequests('Too many requests, slow down.', rl.retryAfterMs);

  let body: { messageId?: unknown; deviceId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!isValidMessageId(body.messageId)) {
    return NextResponse.json({ success: false, error: 'invalid messageId' }, { status: 400 });
  }
  // Played state is per device; without a device id there is no one to record.
  const listener = deviceKey(body.deviceId);
  if (!listener) {
    return NextResponse.json({ success: false, error: 'invalid deviceId' }, { status: 400 });
  }
  const blockedDevice = await assertNotBlocked({ device: listener });
  if (blockedDevice) return blockedApiResponse(blockedDevice);

  try {
    const room = await getRoom(code);
    if (!room) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    if (isRoomExpired(room)) {
      return NextResponse.json({ success: false, error: 'expired' }, { status: 410 });
    }
    const added = await markVoicePlayed(code, body.messageId, listener);
    return NextResponse.json({ success: true, added });
  } catch (err) {
    if (err instanceof Error && err.message === 'message_not_found') {
      return NextResponse.json({ success: false, error: 'message_not_found' }, { status: 404 });
    }
    if (err instanceof Error && err.message === 'not_a_voice_note') {
      return NextResponse.json({ success: false, error: 'not_a_voice_note' }, { status: 400 });
    }
    console.error('Voice played error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}
