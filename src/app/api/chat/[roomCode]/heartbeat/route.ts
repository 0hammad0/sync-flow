import { NextRequest, NextResponse } from 'next/server';
import {
  deviceKey,
  getRoom,
  isRoomExpired,
  sanitizeSenderName,
  sweepStalePresence,
  upsertPresence,
} from '@/shared/lib/firebase/chat';
import { isValidRoomCode } from '@/shared/lib/utils';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

export const runtime = 'nodejs';

// Stale-presence sweeps piggyback on heartbeats, at most once a minute per
// room per instance — no cron needed, and an empty room costs nothing.
const SWEEP_EVERY_MS = 60_000;
const lastSweep = new Map<string, number>();

function shouldSweep(code: string): boolean {
  const now = Date.now();
  if (now - (lastSweep.get(code) ?? 0) < SWEEP_EVERY_MS) return false;
  lastSweep.set(code, now);
  if (lastSweep.size > 2000) lastSweep.clear(); // crude bound
  return true;
}

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
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  const { roomCode } = await params;
  const code = (roomCode || '').toUpperCase();

  if (!isValidRoomCode(code)) {
    return NextResponse.json({ success: false, error: 'invalid_code' }, { status: 400 });
  }

  // ~2 keep-alives/min + typing beats — 40/min per (IP+room) has headroom.
  const rl = rateLimit(`chat:beat:${code}:${clientKey(request)}`, 40, 60_000);
  if (!rl.allowed) return tooManyRequests('Too many heartbeats.', rl.retryAfterMs);

  let body: { deviceId?: unknown; senderName?: unknown; typing?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  // Stored hashed: presence docs are readable, so they must not hold the raw id.
  const deviceId = deviceKey(body.deviceId);
  if (!deviceId) {
    return NextResponse.json({ success: false, error: 'deviceId required' }, { status: 400 });
  }
  const blockedDevice = await assertNotBlocked({ device: deviceId });
  if (blockedDevice) return blockedApiResponse(blockedDevice);
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
    // Heartbeat timeout → "X left" for anyone who stopped beating.
    if (shouldSweep(code)) {
      await sweepStalePresence(code).catch((err) => console.error('Presence sweep error:', err));
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Heartbeat error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}
