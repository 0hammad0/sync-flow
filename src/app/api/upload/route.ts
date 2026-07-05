import { NextRequest, NextResponse } from 'next/server';
import { generateToken, sanitizeFileName, getRequestOrigin, MAX_USER_FILES } from '@/shared/lib/utils';
import { currentUser } from '@/shared/lib/firebase/session';
import { countOwnerFiles, createFile } from '@/shared/lib/firebase/files';
import { deleteObject, putObject } from '@/shared/lib/r2';
import { clientKey, rateLimit } from '@/shared/lib/rate-limit';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_DOWNLOADS_LIMIT = 10_000;

export async function POST(request: NextRequest) {
  try {
    // Public upload endpoint — throttle to blunt abuse (20 per minute per IP).
    const rl = rateLimit(`upload:${clientKey(request)}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many uploads — slow down and try again.' },
        {
          status: 429,
          headers: { 'Retry-After': Math.ceil(rl.retryAfterMs / 1000).toString() },
        }
      );
    }

    const formData = await request.formData();

    const file = formData.get('file') as Blob | null;
    const originalName = formData.get('originalName') as string | null;
    const mimeType = formData.get('mimeType') as string | null;
    const isEncrypted = formData.get('isEncrypted') === 'true';
    const expiresInHoursStr = formData.get('expiresInHours') as string | null;
    const maxDownloadsStr = formData.get('maxDownloads') as string | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }
    if (!originalName) {
      return NextResponse.json({ success: false, error: 'Original file name required' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'File size exceeds 100MB limit' }, { status: 400 });
    }

    const expiresInHours = expiresInHoursStr ? parseInt(expiresInHoursStr, 10) : null;
    const parsedMax = maxDownloadsStr ? parseInt(maxDownloadsStr, 10) : null;
    // Only accept a positive integer within bounds; ignore NaN / negative /
    // zero / absurd values so garbage never reaches Firestore.
    const maxDownloads =
      parsedMax !== null && Number.isFinite(parsedMax) && parsedMax > 0
        ? Math.min(parsedMax, MAX_DOWNLOADS_LIMIT)
        : null;

    let expires_at: string | null = null;
    if (expiresInHours && expiresInHours > 0) {
      expires_at = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
    }

    const user = await currentUser();

    if (user) {
      const count = await countOwnerFiles(user.uid);
      if (count >= MAX_USER_FILES) {
        return NextResponse.json(
          {
            success: false,
            error: `You've reached the limit of ${MAX_USER_FILES} files. Please delete some files from your dashboard to upload more.`,
            limitReached: true,
          },
          { status: 400 }
        );
      }
    }

    const token = generateToken();
    const sanitizedName = sanitizeFileName(originalName);
    const filePath = `${token}/${sanitizedName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const storedContentType = isEncrypted
      ? 'application/octet-stream'
      : mimeType || 'application/octet-stream';

    try {
      await putObject(filePath, buffer, storedContentType);
    } catch (err) {
      // Log details server-side; return a generic message to the client.
      console.error('R2 upload error:', err);
      return NextResponse.json(
        { success: false, error: 'Failed to store the file. Please try again.' },
        { status: 500 }
      );
    }

    try {
      await createFile({
        token,
        file_path: filePath,
        original_name: originalName,
        size: file.size,
        mime_type: mimeType || 'application/octet-stream',
        owner_id: user?.uid ?? null,
        is_encrypted: isEncrypted,
        expires_at,
        max_downloads: maxDownloads,
      });
    } catch (err) {
      console.error('Firestore write error:', err);
      // Roll back the R2 upload so we don't leave an orphan blob.
      await deleteObject(filePath).catch(() => {});
      return NextResponse.json(
        { success: false, error: 'Failed to save the file. Please try again.' },
        { status: 500 }
      );
    }

    const shareUrl = `${getRequestOrigin(request.headers)}/share/${token}`;
    return NextResponse.json({ success: true, shareUrl, token });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
