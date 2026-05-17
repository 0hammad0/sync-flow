import { NextRequest, NextResponse } from 'next/server';
import { generateToken, sanitizeFileName, MAX_USER_FILES } from '@/lib/utils';
import {
  attachFileToSession,
  countOwnerFiles,
  createFile,
  getReceiveSession,
} from '@/lib/firebase/files';
import { deleteObject, putObject } from '@/lib/r2';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get('file') as Blob | null;
    const originalName = formData.get('originalName') as string | null;
    const mimeType = formData.get('mimeType') as string | null;
    const sessionToken = formData.get('sessionToken') as string | null;

    if (!file || !originalName || !sessionToken) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'File size exceeds 100MB limit' }, { status: 400 });
    }

    const session = await getReceiveSession(sessionToken);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }
    if (new Date(session.expires_at) < new Date()) {
      return NextResponse.json({ success: false, error: 'Session expired' }, { status: 410 });
    }
    if (session.file_token) {
      return NextResponse.json({ success: false, error: 'Session already has a file' }, { status: 400 });
    }

    if (session.receiver_id) {
      const count = await countOwnerFiles(session.receiver_id);
      if (count >= MAX_USER_FILES) {
        return NextResponse.json(
          {
            success: false,
            error: `The receiver has reached their file limit (${MAX_USER_FILES} files). They need to delete some files first.`,
          },
          { status: 400 }
        );
      }
    }

    const fileToken = generateToken();
    const sanitizedName = sanitizeFileName(originalName);
    const filePath = `${fileToken}/${sanitizedName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      await putObject(filePath, buffer, mimeType || 'application/octet-stream');
    } catch (err) {
      console.error('R2 upload error:', err);
      return NextResponse.json({ success: false, error: 'Failed to upload file' }, { status: 500 });
    }

    try {
      await createFile({
        token: fileToken,
        file_path: filePath,
        original_name: originalName,
        size: file.size,
        mime_type: mimeType || 'application/octet-stream',
        owner_id: session.receiver_id ?? null,
        is_encrypted: false,
        expires_at: null,
        max_downloads: null,
      });
    } catch (err) {
      console.error('Firestore write error:', err);
      await deleteObject(filePath).catch(() => {});
      return NextResponse.json({ success: false, error: 'Failed to save file metadata' }, { status: 500 });
    }

    try {
      await attachFileToSession(sessionToken, fileToken);
    } catch (err) {
      console.error('Session update error:', err);
      // Non-fatal: file is uploaded; PC poll will time out.
    }

    return NextResponse.json({ success: true, token: fileToken });
  } catch (error) {
    console.error('Send error:', error);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}
