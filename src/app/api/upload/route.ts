import { NextRequest, NextResponse } from 'next/server';
import { generateToken, sanitizeFileName, getRequestOrigin, MAX_USER_FILES } from '@/lib/utils';
import { currentUser } from '@/lib/firebase/session';
import { countOwnerFiles, createFile } from '@/lib/firebase/files';
import { deleteObject, putObject } from '@/lib/r2';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export async function POST(request: NextRequest) {
  try {
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
    const maxDownloads = maxDownloadsStr ? parseInt(maxDownloadsStr, 10) : null;

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
      console.error('R2 upload error:', err);
      const msg = err instanceof Error ? err.message : 'Unknown';
      return NextResponse.json(
        { success: false, error: `Storage error: ${msg}` },
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
      const msg = err instanceof Error ? err.message : 'Unknown';
      return NextResponse.json(
        { success: false, error: `Database error: ${msg}` },
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
