import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/shared/lib/firebase/session';
import {
  addMessage,
  clearPresence,
  deviceKey,
  getRoom,
  hasFreshPresence,
  isRoomExpired,
  PRESENCE_STALE_MS,
  sanitizeSenderName,
  upsertPresence,
} from '@/shared/lib/firebase/chat';
import { isValidRoomCode, sanitizeIanaTz } from '@/shared/lib/utils';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

export const runtime = 'nodejs';

/**
 * Join/leave announcements — written as `kind: 'system'` messages so every
 * subscribed client sees "X joined" / "X left" in real time (WhatsApp-style).
 * "leave" is only sent by the explicit Leave button; closing the tab is
 * handled by the heartbeat timeout (sweepStalePresence), so reloads stay quiet.
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

  // Presence events are rare per client; 10/min per (IP + room) is plenty.
  const rl = rateLimit(`chat:presence:${code}:${clientKey(request)}`, 10, 60_000);
  if (!rl.allowed) return tooManyRequests('Too many presence events.', rl.retryAfterMs);

  let body: {
    event?: unknown;
    senderName?: unknown;
    tz?: unknown;
    deviceId?: unknown;
    rejoin?: unknown;
  };
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

    // Hashed: only the real device (which holds the raw id) maps to its
    // presence doc, so nobody else can clear it or post "left" as it.
    const deviceId = deviceKey(body.deviceId);
    const blockedDevice = await assertNotBlocked({ device: deviceId });
    if (blockedDevice) return blockedApiResponse(blockedDevice);

    // Already online from this device (a reload, a second tab) — refresh
    // presence but don't announce a second "joined".
    if (
      event === 'join' &&
      body.rejoin !== true &&
      deviceId &&
      (await hasFreshPresence(code, deviceId, PRESENCE_STALE_MS).catch(() => false))
    ) {
      await upsertPresence(code, { device_id: deviceId, name: senderName }).catch(() => {});
      return NextResponse.json({ success: true, announced: false });
    }

    const user = await currentUser();
    const message = await addMessage(code, {
      sender_name: senderName,
      sender_id: user?.uid ?? null,
      content: event === 'join' ? 'joined' : 'left',
      sender_tz: tz,
      sender_device_id: deviceId,
      kind: 'system',
    });

    // Keep the online list in sync with join/leave (best effort).
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
