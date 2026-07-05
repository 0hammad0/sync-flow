import { NextRequest, NextResponse } from 'next/server';
import {
  getRoom,
  isRoomExpired,
  sanitizeSenderName,
  toggleReaction,
} from '@/shared/lib/firebase/chat';
import { CHAT_REACTIONS, isValidRoomCode, sanitizeDeviceId } from '@/shared/lib/utils';
import { clientKey, rateLimit } from '@/shared/lib/rate-limit';

export const runtime = 'nodejs';

const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{10,40}$/;

/**
 * POST {messageId, emoji, senderName} — toggle a WhatsApp-style reaction.
 * One reaction per person per message; same emoji again removes it.
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

  const rl = rateLimit(`chat:react:${code}:${clientKey(request)}`, 30, 10_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many reactions, slow down.' },
      {
        status: 429,
        headers: { 'Retry-After': Math.ceil(rl.retryAfterMs / 1000).toString() },
      }
    );
  }

  let body: { messageId?: unknown; emoji?: unknown; senderName?: unknown; deviceId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.messageId !== 'string' || !MESSAGE_ID_RE.test(body.messageId)) {
    return NextResponse.json({ success: false, error: 'invalid messageId' }, { status: 400 });
  }
  if (
    typeof body.emoji !== 'string' ||
    !(CHAT_REACTIONS as readonly string[]).includes(body.emoji)
  ) {
    return NextResponse.json({ success: false, error: 'invalid emoji' }, { status: 400 });
  }
  const senderName = sanitizeSenderName(body.senderName);
  if (senderName.length === 0) {
    return NextResponse.json({ success: false, error: 'senderName empty' }, { status: 400 });
  }
  // Identity = per-device id; clients without one (old tabs) key by name.
  const deviceId = sanitizeDeviceId(body.deviceId);
  const reactor = { id: deviceId ?? `legacy:${senderName}`, name: senderName };

  try {
    const room = await getRoom(code);
    if (!room) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }
    if (isRoomExpired(room)) {
      return NextResponse.json({ success: false, error: 'expired' }, { status: 410 });
    }

    const reacted = await toggleReaction(code, body.messageId, body.emoji, reactor);
    return NextResponse.json({ success: true, reacted });
  } catch (err) {
    if (err instanceof Error && err.message === 'message_not_found') {
      return NextResponse.json({ success: false, error: 'message_not_found' }, { status: 404 });
    }
    if (err instanceof Error && err.message === 'cannot_react_to_system') {
      return NextResponse.json({ success: false, error: 'cannot_react_to_system' }, { status: 400 });
    }
    console.error('Reaction error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}
