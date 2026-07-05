import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/shared/lib/firebase/session';
import {
  addMessage,
  buildReplyRef,
  getMessage,
  getRoom,
  isRoomExpired,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_BYTES,
  roomStoragePrefix,
  sanitizeSenderName,
} from '@/shared/lib/firebase/chat';
import type { ChatAttachment, ChatReplyRef } from '@/types';

const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{10,40}$/;
const MAX_ALBUM_FILES = 10;

/**
 * Validate a client-supplied attachments array (files were uploaded
 * beforehand via /attachments?uploadOnly=1). Keys are constrained to THIS
 * room's storage prefix so a message can't point at other rooms' files.
 * Returns the cleaned array, or null when the shape is invalid.
 */
function validateAttachments(raw: unknown, code: string): ChatAttachment[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ALBUM_FILES) return null;
  const prefix = roomStoragePrefix(code);
  const out: ChatAttachment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const { key, name, size, mime_type } = entry as Record<string, unknown>;
    if (typeof key !== 'string' || !key.startsWith(prefix) || key.includes('..')) return null;
    if (typeof name !== 'string' || name.length === 0 || name.length > 255) return null;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) return null;
    if (typeof mime_type !== 'string' || mime_type.length > 120) return null;
    out.push({ key, name, size, mime_type });
  }
  return out;
}
import { isValidRoomCode, sanitizeDeviceId, sanitizeIanaTz } from '@/shared/lib/utils';
import { clientKey, rateLimit } from '@/shared/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  const { roomCode } = await params;
  const code = (roomCode || '').toUpperCase();

  if (!isValidRoomCode(code)) {
    return NextResponse.json({ success: false, error: 'invalid_code' }, { status: 400 });
  }

  // 30 messages per 10 seconds per (IP + room) — generous for normal chat,
  // tight enough to stop runaway scripts.
  const rl = rateLimit(`chat:msg:${code}:${clientKey(request)}`, 30, 10_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many messages, slow down.' },
      {
        status: 429,
        headers: { 'Retry-After': Math.ceil(rl.retryAfterMs / 1000).toString() },
      }
    );
  }

  let body: {
    senderName?: unknown;
    content?: unknown;
    tz?: unknown;
    replyToId?: unknown;
    deviceId?: unknown;
    attachments?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (
    body.replyToId !== undefined &&
    (typeof body.replyToId !== 'string' || !MESSAGE_ID_RE.test(body.replyToId))
  ) {
    return NextResponse.json({ success: false, error: 'invalid replyToId' }, { status: 400 });
  }

  if (typeof body.senderName !== 'string') {
    return NextResponse.json({ success: false, error: 'senderName required' }, { status: 400 });
  }
  const senderName = sanitizeSenderName(body.senderName);
  if (senderName.length === 0) {
    return NextResponse.json({ success: false, error: 'senderName empty' }, { status: 400 });
  }

  // attachments (optional album of pre-uploaded files)
  let attachments: ChatAttachment[] | undefined;
  if (body.attachments !== undefined) {
    const cleaned = validateAttachments(body.attachments, code);
    if (!cleaned) {
      return NextResponse.json({ success: false, error: 'invalid attachments' }, { status: 400 });
    }
    attachments = cleaned;
  }

  // content — may be empty when the message is an attachment album (the
  // caption is optional, like WhatsApp).
  if (typeof body.content !== 'string') {
    return NextResponse.json({ success: false, error: 'content required' }, { status: 400 });
  }
  const content = body.content;
  if (content.length === 0 && !attachments) {
    return NextResponse.json({ success: false, error: 'content empty' }, { status: 400 });
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_MESSAGE_BYTES) {
    return NextResponse.json(
      { success: false, error: `Message exceeds ${MAX_MESSAGE_BYTES} bytes` },
      { status: 413 }
    );
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

    // Server-built quote ref — clients can't forge who/what they reply to.
    let reply_to: ChatReplyRef | undefined;
    if (typeof body.replyToId === 'string') {
      const target = await getMessage(code, body.replyToId);
      if (!target || target.kind === 'system') {
        return NextResponse.json(
          { success: false, error: 'reply_target_not_found' },
          { status: 400 }
        );
      }
      reply_to = buildReplyRef(target);
    }

    const user = await currentUser();
    const message = await addMessage(code, {
      sender_name: senderName,
      sender_id: user?.uid ?? null,
      sender_device_id: sanitizeDeviceId(body.deviceId),
      content,
      sender_tz: tz,
      // Single file keeps the legacy field too so older readers still work.
      attachment: attachments?.length === 1 ? attachments[0] : undefined,
      attachments,
      reply_to,
    });

    return NextResponse.json({ success: true, id: message.id });
  } catch (err) {
    console.error('Send message error:', err);
    return NextResponse.json(
      { success: false, error: 'unexpected' },
      { status: 500 }
    );
  }
}
