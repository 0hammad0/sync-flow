import { NextRequest, NextResponse } from 'next/server';
import { putObject } from '@/shared/lib/r2';
import { finishSendUpload, planSendUpload } from '@/features/files/server/send-upload';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

/**
 * Legacy multipart phone → PC upload, kept on purpose for scripts and API
 * clients that post multipart (as scripts/e2e-*.mjs do with the matching
 * /api/upload route). No page in the app calls it: the phone uses
 * /api/send/presign → PUT to R2 → /api/send/complete. The file body passes
 * through this function, so hosting body caps apply (Vercel: ~4.5 MB).
 * Same rules as the direct flow (shared send-upload.ts).
 */
export async function POST(request: NextRequest) {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  try {
    // Shares the presign route's bucket (40 per minute per IP).
    const rl = rateLimit(`send:${clientKey(request)}`, 40, 60_000);
    if (!rl.allowed) {
      return tooManyRequests('Too many uploads — slow down and try again.', rl.retryAfterMs);
    }

    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    if (!file) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const planned = await planSendUpload({
      sessionToken: formData.get('sessionToken'),
      originalName: formData.get('originalName'),
      mimeType: formData.get('mimeType'),
      size: file.size,
    });
    if ('error' in planned) return planned.error;
    const { plan } = planned;

    try {
      await putObject(plan.key, Buffer.from(await file.arrayBuffer()), plan.mime);
    } catch (err) {
      console.error('R2 upload error:', err);
      return NextResponse.json({ success: false, error: 'Failed to upload file' }, { status: 500 });
    }

    return finishSendUpload(plan);
  } catch (error) {
    console.error('Send error:', error);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}
