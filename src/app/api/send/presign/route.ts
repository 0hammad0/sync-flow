import { NextRequest, NextResponse } from 'next/server';
import { signedUploadUrl } from '@/shared/lib/r2';
import { SEND_LATE_FILE_GRACE_MS } from '@/shared/lib/limits';
import { createUploadTicket } from '@/shared/lib/upload-ticket';
import { planSendUpload } from '@/features/files/server/send-upload';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

/**
 * Step 1 of a direct-to-R2 phone → PC upload. Body (JSON):
 * { sessionToken, originalName, mimeType, size }.
 * Returns { uploadUrl, contentType, ticket }.
 */
export async function POST(request: NextRequest) {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  try {
    // Public endpoint — throttle per IP. A session holds at most
    // MAX_SESSION_FILES (25) files, so 40 per minute leaves room for a full batch plus retries.
    const rl = rateLimit(`send:${clientKey(request)}`, 40, 60_000);
    if (!rl.allowed) {
      return tooManyRequests('Too many uploads — slow down and try again.', rl.retryAfterMs);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    const planned = await planSendUpload({
      sessionToken: body.sessionToken,
      originalName: body.originalName,
      mimeType: body.mimeType,
      size: body.size,
    });
    if ('error' in planned) return planned.error;
    const { plan } = planned;

    // The URL's lifetime is also how long the PC keeps listening after the
    // session expires, so a file presigned at the last second still shows up.
    const uploadUrl = await signedUploadUrl(
      plan.key,
      plan.mime,
      plan.size,
      SEND_LATE_FILE_GRACE_MS / 1000
    );
    return NextResponse.json({
      success: true,
      uploadUrl,
      contentType: plan.mime,
      ticket: createUploadTicket({ kind: 'send', plan }),
    });
  } catch (error) {
    console.error('Send presign error:', error);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}
