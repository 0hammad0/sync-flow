import { NextRequest, NextResponse } from 'next/server';
import { getFile, getReceiveSession } from '@/shared/lib/firebase/files';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionToken: string }> }
) {
  try {
    const { sessionToken } = await params;
    const session = await getReceiveSession(sessionToken);

    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    if (new Date(session.expires_at) < new Date()) {
      return NextResponse.json({ success: false, error: 'Session expired' }, { status: 410 });
    }

    const tokens =
      session.file_tokens && session.file_tokens.length > 0
        ? session.file_tokens
        : session.file_token
          ? [session.file_token]
          : [];

    if (tokens.length > 0) {
      const records = await Promise.all(tokens.map((t) => getFile(t)));
      const files = records
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .map((f) => ({
          name: f.original_name,
          size: f.size,
          mimeType: f.mime_type,
          token: f.token,
          isEncrypted: f.is_encrypted,
        }));
      return NextResponse.json({
        success: true,
        // The session stays open for more files until it expires.
        status: 'completed',
        file: files[files.length - 1] ?? null, // legacy single-file readers
        files,
        expiresAt: session.expires_at,
      });
    }

    return NextResponse.json({
      success: true,
      status: 'waiting',
      files: [],
      expiresAt: session.expires_at,
    });
  } catch (error) {
    console.error('Check receive session error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
