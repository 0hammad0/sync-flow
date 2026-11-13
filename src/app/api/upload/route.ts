import { NextRequest, NextResponse } from 'next/server';
import { getRequestOrigin } from '@/shared/lib/utils';
import { currentUser } from '@/shared/lib/firebase/session';
import { putObject } from '@/shared/lib/r2';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { finishShareUpload, planShareUpload } from '@/features/files/server/share-upload';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

/**
 * LEGACY multipart upload — the app's own UI does not call this. The browser
 * uses the direct-to-R2 flow (/api/upload/presign → PUT → /api/upload/complete)
 * because here the file body passes through this function and hosting
 * platforms cap request bodies (Vercel: ~4.5 MB, so larger files fail with 413).
 * Kept for the e2e scripts (scripts/e2e-*.mjs) and other API/script clients
 * sending small files. Same rules as the direct flow via share-upload.ts.
 */
export async function POST(request: NextRequest) {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  try {
    // Public upload endpoint — throttle to blunt abuse (20 per minute per IP).
    const rl = rateLimit(`upload:${clientKey(request)}`, 20, 60_000);
    if (!rl.allowed) {
      return tooManyRequests('Too many uploads — slow down and try again.', rl.retryAfterMs);
    }

    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const user = await currentUser();
    const planned = await planShareUpload({
      originalName: formData.get('originalName'),
      mimeType: formData.get('mimeType'),
      size: file.size,
      isEncrypted: formData.get('isEncrypted') === 'true',
      expiresInHours: formData.get('expiresInHours'),
      maxDownloads: formData.get('maxDownloads'),
      ownerId: user?.uid ?? null,
      asMember: formData.get('asMember') === 'true',
    });
    if ('error' in planned) return planned.error;
    const { plan } = planned;

    try {
      await putObject(plan.key, Buffer.from(await file.arrayBuffer()), plan.storedType);
    } catch (err) {
      // Log details server-side; return a generic message to the client.
      console.error('R2 upload error:', err);
      return NextResponse.json(
        { success: false, error: 'Failed to store the file. Please try again.' },
        { status: 500 }
      );
    }

    return finishShareUpload(plan, getRequestOrigin(request.headers));
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
