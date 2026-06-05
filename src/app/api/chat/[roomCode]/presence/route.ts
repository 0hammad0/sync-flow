import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/firebase/session';
import {
  addMessage,
  clearPresence,
  getRoom,
  isRoomExpired,
  sanitizeSenderName,
  upsertPresence,
} from '@/lib/firebase/chat';
import { isValidRoomCode, sanitizeDeviceId, sanitizeIanaTz } from '@/lib/utils';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Join/leave announcements — written as `kind: 'system'` messages so every
 * subscribed client sees "X joined" / "X left" in real time (WhatsApp-style).
 * Leave events arrive via navigator.sendBeacon on pagehide.
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

  // Presence events are rare per client; 10/min per (IP + room) is plenty.
  const rl = rateLimit(`chat:presence:${code}:${clientKey(request)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many presence events.' },
      {
        status: 429,
        headers: { 'Retry-After': Math.ceil(rl.retryAfterMs / 1000).toString() },
      }
    );
  }

  let body: { event?: unknown; senderName?: unknown; tz?: unknown; deviceId?: unknown };
  try {
    // sendBeacon may post as text/plain — parse the raw text as JSON.
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const event = body.event;
  if (event !== 'join' && event !== 'leave') {
    return NextResponse.json({ success: false, error: 'event must be join|leave' }, { status: 400 });
  }

  const senderName = sanitizeSenderName(body.senderName);
  if (senderName.length === 0) {
    return NextResponse.json({ success: false, error: 'senderName empty' }, { status: 400 });
  }

  const tz = sanitizeIanaTz(body.tz);

  try {
    const room = await getRoom(code);
    if (!room) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }
    if (isRoomExpired(room)) {
      return NextResponse.json({ success: false, error: 'expired' }, { status: 410 });
    }

    const user = await currentUser();
    const message = await addMessage(code, {
      sender_name: senderName,
      sender_id: user?.uid ?? null,
      content: event === 'join' ? 'joined' : 'left',
      sender_tz: tz,
      kind: 'system',
    });

    // Keep the online list in sync with join/leave (best effort).
    const deviceId = sanitizeDeviceId(body.deviceId);
    if (deviceId) {
      if (event === 'join') {
        await upsertPresence(code, { device_id: deviceId, name: senderName }).catch(() => {});
      } else {
        await clearPresence(code, deviceId).catch(() => {});
      }
    }

    return NextResponse.json({ success: true, id: message.id });
  } catch (err) {
    console.error('Presence event error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}
