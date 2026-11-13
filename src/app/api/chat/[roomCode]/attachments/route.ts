import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/shared/lib/firebase/session';
import {
  addMessage,
  buildReplyRef,
  getMessage,
  getRoom,
  isAlreadyExistsError,
  isAttachmentClaimed,
  isRoomExpired,
  sanitizeSenderName,
  roomStoragePrefix,
} from '@/shared/lib/firebase/chat';
import { deviceKey } from '@/server/device-key';
import type { ChatReplyRef } from '@/types';
import { isValidMessageId, isValidRoomCode, sanitizeIanaTz } from '@/shared/lib/utils';
import { deleteObject, objectExists, putObject, signedDownloadUrl } from '@/shared/lib/r2';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { readUploadTicket, verifyUploadedObject } from '@/shared/lib/upload-ticket';
import {
  attachmentDownloadName,
  planAttachment,
  signAttachmentProof,
  type AttachmentPlan,
} from '@/features/chat/server/attachment-upload';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

export const runtime = 'nodejs';

const MAX_CAPTION_LENGTH = 2_000;

/**
 * POST — share an image/video/file in the room (WhatsApp-style attachment).
 * Stores the body in R2 under chat/{roomCode}/... and writes a chat message
 * carrying the attachment metadata; every subscriber sees it in real time.
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

  // JSON body = step 3 of the direct-to-R2 flow (the bytes are already in R2;
  // presign applied the upload limit). Completing posts a message, so it
  // shares the message-send bucket (30 per 10s per IP + room) — the ticket
  // alone must not be a way around it.
  const isJson = (request.headers.get('content-type') || '').includes('application/json');
  if (isJson) {
    const rl = rateLimit(`chat:msg:${code}:${clientKey(request)}`, 30, 10_000);
    if (!rl.allowed) return tooManyRequests('Too many messages, slow down.', rl.retryAfterMs);
    return completeDirectUpload(request, code);
  }

  // Legacy multipart path: the body passes through this function, so hosting
  // body caps apply. The app no longer uses it (it uploads direct-to-R2), but
  // scripts/e2e-chat.mjs does — keep it.
  // Attachments are heavier than text — 10 per minute per (IP + room).
  const rl = rateLimit(`chat:attach:${code}:${clientKey(request)}`, 10, 60_000);
  if (!rl.allowed) return tooManyRequests('Too many uploads, slow down.', rl.retryAfterMs);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as Blob | null;
  if (!file) {
    return NextResponse.json({ success: false, error: 'file and originalName required' }, { status: 400 });
  }
  const isLongText = formData.get('longText') === '1';
  const planned = planAttachment(code, {
    originalName: formData.get('originalName'),
    size: file.size,
    mimeType: file.type,
    longText: isLongText,
  });
  if ('error' in planned) return planned.error;
  const fields = readMessageFields({
    senderName: formData.get('senderName'),
    caption: formData.get('caption'),
    tz: formData.get('tz'),
    replyToId: formData.get('replyToId'),
    deviceId: formData.get('deviceId'),
    uploadOnly: formData.get('uploadOnly') === '1',
  });
  if ('error' in fields) return fields.error;
  const blockedDevice = await assertNotBlocked({ device: fields.deviceId });
  if (blockedDevice) return blockedApiResponse(blockedDevice);

  try {
    const pre = await checkRoomAndReply(code, fields.replyToId);
    if ('error' in pre) return pre.error;

    await putObject(planned.plan.key, Buffer.from(await file.arrayBuffer()), planned.plan.mime);
    return await finishAttachment(code, planned.plan, fields, pre.reply_to);
  } catch (err) {
    console.error('Chat attachment error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}

/**
 * Message id for the message a ticket posts. Derived from the object key
 * (random per presign), so posting twice with one ticket targets the same
 * doc and `.create()` rejects the second — each ticket posts at most once.
 * 32 hex chars fits MESSAGE_ID_RE, so replies/reactions accept it.
 */
function ticketMessageId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

const ticketUsed = () =>
  NextResponse.json(
    { success: false, error: 'This upload was already sent.' },
    { status: 409 }
  );

async function completeDirectUpload(request: NextRequest, code: string) {
  const body = await request.json().catch(() => null);
  const data = readUploadTicket<{ kind: string; plan: AttachmentPlan }>(body?.ticket);
  if (!data || data.kind !== 'chat' || data.plan.code !== code) {
    return NextResponse.json(
      { success: false, error: 'This upload has expired or is invalid. Please upload again.' },
      { status: 400 }
    );
  }
  const { plan } = data;
  const messageId = ticketMessageId(plan.key);

  // Replay of a ticket whose file is already in a message (its own, or an
  // album's): reject BEFORE any error path below can delete the object,
  // which now belongs to that message. The claim batch in addMessage is the
  // race-proof guard; this is the early exit. Repeating an uploadOnly
  // complete before the album is sent only returns the same proof again —
  // the claim still lets that file be posted once.
  const [claimed, existing] = await Promise.all([
    isAttachmentClaimed(code, plan.key).catch(() => false),
    getMessage(code, messageId).catch(() => null),
  ]);
  if (claimed || existing) return ticketUsed();
  const fields = readMessageFields({
    senderName: body.senderName,
    caption: body.caption,
    tz: body.tz,
    replyToId: body.replyToId,
    deviceId: body.deviceId,
    uploadOnly: body.uploadOnly === true,
  });
  if ('error' in fields) {
    await deleteObject(plan.key).catch(() => {});
    return fields.error;
  }
  const blockedDevice = await assertNotBlocked({ device: fields.deviceId });
  if (blockedDevice) {
    // Same as any refused complete: the uploaded object is not kept.
    await deleteObject(plan.key).catch(() => {});
    return blockedApiResponse(blockedDevice);
  }

  try {
    const problem = await verifyUploadedObject(plan.key, plan.size);
    if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });

    const pre = await checkRoomAndReply(code, fields.replyToId);
    if ('error' in pre) {
      await deleteObject(plan.key).catch(() => {});
      return pre.error;
    }
    return await finishAttachment(code, plan, fields, pre.reply_to, messageId);
  } catch (err) {
    console.error('Chat attachment complete error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}

// ---------- shared by the direct complete and legacy multipart paths ----------

interface MessageFields {
  senderName: string;
  captionText: string;
  tz: ReturnType<typeof sanitizeIanaTz>;
  replyToId: string | null;
  /** Hashed device id (deviceKey) — never the raw one. */
  deviceId: string | null;
  uploadOnly: boolean;
}

function readMessageFields(input: {
  senderName: unknown;
  caption: unknown;
  tz: unknown;
  replyToId: unknown;
  deviceId: unknown;
  uploadOnly: boolean;
}): MessageFields | { error: NextResponse } {
  const replyToIdRaw = input.replyToId ?? null;
  if (replyToIdRaw !== null && replyToIdRaw !== '' && !isValidMessageId(replyToIdRaw)) {
    return { error: NextResponse.json({ success: false, error: 'invalid replyToId' }, { status: 400 }) };
  }
  const senderName = sanitizeSenderName(input.senderName);
  if (senderName.length === 0) {
    return { error: NextResponse.json({ success: false, error: 'senderName empty' }, { status: 400 }) };
  }
  return {
    senderName,
    // Multipart encoding CRLF-normalizes text fields (browsers included) —
    // undo it so captions/previews keep the exact newlines the user typed.
    captionText:
      typeof input.caption === 'string'
        ? input.caption.replace(/\r\n/g, '\n').slice(0, MAX_CAPTION_LENGTH)
        : '',
    tz: sanitizeIanaTz(input.tz),
    replyToId: typeof replyToIdRaw === 'string' && replyToIdRaw !== '' ? replyToIdRaw : null,
    deviceId: deviceKey(input.deviceId),
    uploadOnly: input.uploadOnly,
  };
}

async function checkRoomAndReply(
  code: string,
  replyToId: string | null
): Promise<{ reply_to: ChatReplyRef | undefined } | { error: NextResponse }> {
  const room = await getRoom(code);
  if (!room) {
    return { error: NextResponse.json({ success: false, error: 'not_found' }, { status: 404 }) };
  }
  if (isRoomExpired(room)) {
    return { error: NextResponse.json({ success: false, error: 'expired' }, { status: 410 }) };
  }
  // Server-built quote ref — clients can't forge who/what they reply to.
  let reply_to: ChatReplyRef | undefined;
  if (replyToId) {
    const target = await getMessage(code, replyToId);
    if (!target || target.kind === 'system') {
      return {
        error: NextResponse.json({ success: false, error: 'reply_target_not_found' }, { status: 400 }),
      };
    }
    reply_to = buildReplyRef(target);
  }
  return { reply_to };
}

/** The object is in R2: return album metadata, or post the message. */
async function finishAttachment(
  code: string,
  plan: AttachmentPlan,
  fields: MessageFields,
  reply_to: ChatReplyRef | undefined,
  /** Set on the ticket path: makes the post single-use (see ticketMessageId). */
  messageId?: string
): Promise<NextResponse> {
  // Multi-file albums: each file is uploaded separately (uploadOnly),
  // then ONE message referencing all of them is posted via /messages, which
  // only accepts files carrying this proof.
  // Orphans from abandoned sends are reclaimed with the room's prefix wipe.
  if (fields.uploadOnly) {
    // Voice notes are always sent on their own, never inside an album.
    if (plan.voice) {
      await deleteObject(plan.key).catch(() => {});
      return NextResponse.json({ success: false, error: 'invalid voice note' }, { status: 400 });
    }
    const attachment = { key: plan.key, name: plan.name, size: plan.size, mime_type: plan.mime };
    return NextResponse.json({
      success: true,
      attachment: { ...attachment, proof: signAttachmentProof(code, attachment) },
    });
  }

  const user = await currentUser();
  try {
    const message = await addMessage(
      code,
      {
        sender_name: fields.senderName,
        sender_id: user?.uid ?? null,
        sender_device_id: fields.deviceId,
        content: fields.captionText,
        sender_tz: fields.tz,
        attachment: {
          key: plan.key,
          name: plan.name,
          size: plan.size,
          mime_type: plan.mime,
          is_long_text: plan.longText,
          ...(plan.voice ? { voice: plan.voice } : {}),
        },
        reply_to,
      },
      // Ticket path: also claim the key, so an album can't reuse this file.
      { id: messageId, claimKeys: messageId ? [plan.key] : undefined }
    );
    return NextResponse.json({ success: true, id: message.id });
  } catch (err) {
    // A concurrent replay won the create: the object is that message's file,
    // so leave it alone.
    if (messageId && isAlreadyExistsError(err)) return ticketUsed();
    // Roll back the R2 upload so we don't leave an orphan blob.
    await deleteObject(plan.key).catch(() => {});
    throw err;
  }
}

/**
 * GET ?key=...&download=1 — redirect to a fresh 1-hour signed R2 URL for an
 * attachment of THIS room. <img>/<video> tags point here directly, so media
 * keeps working long after any individual signed URL would have expired.
 *
 * download=1 signs `Content-Disposition: attachment` so the browser saves the
 * file instead of opening it; optional &name= is the original filename,
 * accepted only if it matches the key (attachmentDownloadName).
 * &format=json (one-tap download buttons) returns { url } instead of a
 * redirect, after checking the object still exists — so the client can show
 * a clean error instead of navigating to an R2 error page. Same checks as the
 * redirect: key inside this room's prefix, room exists and is not expired.
 */
export async function GET(
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

  const key = request.nextUrl.searchParams.get('key') || '';
  const wantsJson = request.nextUrl.searchParams.get('format') === 'json';
  const wantsDownload = wantsJson || request.nextUrl.searchParams.get('download') === '1';

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

    const filename = attachmentDownloadName(key, request.nextUrl.searchParams.get('name'));

    if (wantsJson) {
      if (!(await objectExists(key))) {
        return NextResponse.json({ success: false, error: 'file_not_found' }, { status: 404 });
      }
      // Used at once by the client, so a short life is plenty.
      const url = await signedDownloadUrl(key, 300, { downloadFilename: filename });
      return NextResponse.json(
        { success: true, url },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const signedUrl = await signedDownloadUrl(key, 3600, {
      downloadFilename: wantsDownload ? filename : undefined,
    });
    return NextResponse.redirect(signedUrl, 302);
  } catch (err) {
    console.error('Chat attachment fetch error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}
