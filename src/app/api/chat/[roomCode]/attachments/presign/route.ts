import { NextRequest, NextResponse } from 'next/server';
import { getRoom, isRoomExpired } from '@/shared/lib/firebase/chat';
import { isValidRoomCode } from '@/shared/lib/utils';
import { signedUploadUrl } from '@/shared/lib/r2';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { createUploadTicket } from '@/shared/lib/upload-ticket';
import { planAttachment } from '@/features/chat/server/attachment-upload';

export const runtime = 'nodejs';

/**
 * Step 1 of a direct-to-R2 chat attachment. Body (JSON):
 * { originalName, size, mimeType, longText?, voice? }. `voice` ({ duration_ms,
 * peaks }) marks a recorded voice note; see features/chat/lib/voice.ts.
 * Returns { uploadUrl, contentType, ticket }. Step 3 is a JSON POST to
 * /api/chat/[roomCode]/attachments with { ticket, senderName, caption, ... }.
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
  if (!rl.allowed) return tooManyRequests('Too many uploads, slow down.', rl.retryAfterMs);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }

  const planned = planAttachment(code, {
    originalName: body.originalName,
    size: body.size,
    mimeType: body.mimeType,
    longText: body.longText === true,
    voice: body.voice,
  });
  if ('error' in planned) return planned.error;
  const { plan } = planned;

  try {
    const room = await getRoom(code);
    if (!room) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }
    if (isRoomExpired(room)) {
      return NextResponse.json({ success: false, error: 'expired' }, { status: 410 });
    }

    const uploadUrl = await signedUploadUrl(plan.key, plan.mime, plan.size);
    return NextResponse.json({
      success: true,
      uploadUrl,
      contentType: plan.mime,
      ticket: createUploadTicket({ kind: 'chat', plan }),
    });
  } catch (err) {
    console.error('Chat attachment presign error:', err);
    return NextResponse.json({ success: false, error: 'unexpected' }, { status: 500 });
  }
}
