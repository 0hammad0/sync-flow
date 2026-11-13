import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/shared/lib/firebase/session';
import { signedUploadUrl } from '@/shared/lib/r2';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { createUploadTicket } from '@/shared/lib/upload-ticket';
import { planShareUpload } from '@/features/files/server/share-upload';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

/**
 * Step 1 of a direct-to-R2 share upload. Body (JSON):
 * { originalName, mimeType, size, isEncrypted, expiresInHours?, maxDownloads?, asMember? }
 * `size` is the byte length of what will be PUT (the ciphertext when encrypted).
 * `asMember: true` = the form showed signed-in options; a 401 with
 * `signInRequired` comes back if the session has expired since.
 * Returns { uploadUrl, contentType, ticket }.
 */
export async function POST(request: NextRequest) {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  try {
    const rl = rateLimit(`upload:${clientKey(request)}`, 20, 60_000);
    if (!rl.allowed) {
      return tooManyRequests('Too many uploads — slow down and try again.', rl.retryAfterMs);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    const user = await currentUser();
    const planned = await planShareUpload({
      originalName: body.originalName,
      mimeType: body.mimeType,
      size: body.size,
      isEncrypted: body.isEncrypted === true,
      expiresInHours: body.expiresInHours,
      maxDownloads: body.maxDownloads,
      ownerId: user?.uid ?? null,
      asMember: body.asMember === true,
    });
    if ('error' in planned) return planned.error;
    const { plan } = planned;

    const uploadUrl = await signedUploadUrl(plan.key, plan.storedType, plan.size);
    return NextResponse.json({
      success: true,
      uploadUrl,
      contentType: plan.storedType,
      ticket: createUploadTicket({ kind: 'share', plan }),
    });
  } catch (error) {
    console.error('Upload presign error:', error);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}
