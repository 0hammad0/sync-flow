import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/shared/lib/firebase/session';
import {
  addMessage,
  buildReplyRef,
  getMessage,
  getRoom,
  isRoomExpired,
  sanitizeSenderName,
  roomStoragePrefix,
  MAX_ATTACHMENT_BYTES,
} from '@/shared/lib/firebase/chat';
import type { ChatReplyRef } from '@/types';
import {
  generateToken,
  isValidRoomCode,
  MAX_LONG_TEXT_BYTES,
  sanitizeDeviceId,
  sanitizeFileName,
  sanitizeIanaTz,
} from '@/shared/lib/utils';
import { deleteObject, putObject, signedDownloadUrl } from '@/shared/lib/r2';
import { clientKey, rateLimit } from '@/shared/lib/rate-limit';

export const runtime = 'nodejs';

const MAX_CAPTION_LENGTH = 2_000;
const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{10,40}$/;

/**
 * POST — share an image/video/file in the room (WhatsApp-style attachment).
 * Stores the body in R2 under chat/{roomCode}/... and writes a chat message
 * carrying the attachment metadata; every subscriber sees it in real time.
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

  // Attachments are heavier than text — 10 per minute per (IP + room).
  const rl = rateLimit(`chat:attach:${code}:${clientKey(request)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many uploads, slow down.' },
      {
        status: 429,
        headers: { 'Retry-After': Math.ceil(rl.retryAfterMs / 1000).toString() },
      }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as Blob | null;
  const originalName = formData.get('originalName');
  const senderName = sanitizeSenderName(formData.get('senderName'));
  const caption = formData.get('caption');
  const tz = sanitizeIanaTz(formData.get('tz'));
  const replyToIdRaw = formData.get('replyToId');

  if (
    replyToIdRaw !== null &&
    replyToIdRaw !== '' &&
    (typeof replyToIdRaw !== 'string' || !MESSAGE_ID_RE.test(replyToIdRaw))
  ) {
    return NextResponse.json({ success: false, error: 'invalid replyToId' }, { status: 400 });
  }
  const replyToId = typeof replyToIdRaw === 'string' && replyToIdRaw !== '' ? replyToIdRaw : null;

  if (!file || typeof originalName !== 'string' || originalName.length === 0) {
    return NextResponse.json({ success: false, error: 'file and originalName required' }, { status: 400 });
  }
  if (senderName.length === 0) {
    return NextResponse.json({ success: false, error: 'senderName empty' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ success: false, error: 'File is empty' }, { status: 400 });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json(
      { success: false, error: 'File size exceeds 100MB limit' },
      { status: 413 }
    );
  }
  // Long-text bodies (the overflow path for big typed messages) cap at 15MB.
  const isLongText = formData.get('longText') === '1';
  if (isLongText && file.size > MAX_LONG_TEXT_BYTES) {
    return NextResponse.json(
      { success: false, error: 'Message is too long (limit 15 MB).' },
      { status: 413 }
    );
  }
  // Multipart encoding CRLF-normalizes text fields (browsers included) —
  // undo it so captions/previews keep the exact newlines the user typed.
  const captionText =
    typeof caption === 'string'
      ? caption.replace(/\r\n/g, '\n').slice(0, MAX_CAPTION_LENGTH)
      : '';

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
    if (replyToId) {
      const target = await getMessage(code, replyToId);
      if (!target || target.kind === 'system') {
        return NextResponse.json(
          { success: false, error: 'reply_target_not_found' },
          { status: 400 }
        );
      }
      reply_to = buildReplyRef(target);
    }

    const sanitizedName = sanitizeFileName(originalName);
    const key = `${roomStoragePrefix(code)}${generateToken()}/${sanitizedName}`;
    const mimeType = isLongText
      ? 'text/plain; charset=utf-8'
      : file.type || 'application/octet-stream';

    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(key, buffer, mimeType);

    // Multi-file albums: each file is uploaded separately (uploadOnly=1),
    // then ONE message referencing all of them is posted via /messages.
    // Orphans from abandoned sends are reclaimed with the room's prefix wipe.
    if (formData.get('uploadOnly') === '1') {
      return NextResponse.json({
        success: true,
        attachment: { key, name: originalName, size: file.size, mime_type: mimeType },
      });
    }

    const user = await currentUser();
    try {
      const message = await addMessage(code, {
        sender_name: senderName,
        sender_id: user?.uid ?? null,
        sender_device_id: sanitizeDeviceId(formData.get('deviceId')),
        content: captionText,
        sender_tz: tz,
        attachment: {
          key,
          name: originalName,
          size: file.size,
          mime_type: mimeType,
          is_long_text: isLongText,
        },
        reply_to,
      });
      return NextResponse.json({ success: true, id: message.id });
    } catch (err) {
      // Roll back the R2 upload so we don't leave an orphan blob.
      await deleteObject(key).catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error('Chat attachment error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}

/**
 * GET ?key=...&download=1 — redirect to a fresh 1-hour signed R2 URL for an
 * attachment of THIS room. <img>/<video> tags point here directly, so media
 * keeps working long after any individual signed URL would have expired.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  const { roomCode } = await params;
  const code = (roomCode || '').toUpperCase();

  if (!isValidRoomCode(code)) {
    return NextResponse.json({ success: false, error: 'invalid_code' }, { status: 400 });
  }

  const key = request.nextUrl.searchParams.get('key') || '';
  const wantsDownload = request.nextUrl.searchParams.get('download') === '1';

  // The key must live inside this room's storage prefix — prevents using a
  // room code to read other rooms' files or the file-sharing area.
  if (!key.startsWith(roomStoragePrefix(code)) || key.includes('..')) {
    return NextResponse.json({ success: false, error: 'invalid_key' }, { status: 400 });
  }

  try {
    const room = await getRoom(code);
    if (!room) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }
    if (isRoomExpired(room)) {
      return NextResponse.json({ success: false, error: 'expired' }, { status: 410 });
    }

    const filename = key.split('/').pop() || 'file';
    const signedUrl = await signedDownloadUrl(key, 3600, {
      downloadFilename: wantsDownload ? filename : undefined,
    });
    return NextResponse.redirect(signedUrl, 302);
  } catch (err) {
    console.error('Chat attachment fetch error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}
