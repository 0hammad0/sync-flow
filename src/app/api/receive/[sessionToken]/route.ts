import { NextRequest, NextResponse } from 'next/server';
import { getFile, getReceiveSession } from '@/shared/lib/firebase/files';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

/**
 * GET — the PC polls this for files sent to its session. An expired session
 * still returns its files (status 'expired'): a file presigned just before
 * the end can land later, and the PC keeps polling for a grace period to show
 * it. `?peek=1` (used by the phone) answers 410 once the session has expired.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionToken: string }> }
) {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  try {
    const { sessionToken } = await params;
    const session = await getReceiveSession(sessionToken);

    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    const expired = new Date(session.expires_at) < new Date();

    // Seconds left by the server clock, so a skewed device clock can't drift the timer.
    const expiresIn = Math.max(0, Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000));

    // ?peek=1 — the phone only needs to know the link is still open (no file reads).
    if (request.nextUrl.searchParams.get('peek') === '1') {
      if (expired) {
        return NextResponse.json({ success: false, error: 'Session expired' }, { status: 410 });
      }
      return NextResponse.json({ success: true, expiresAt: session.expires_at, expiresIn });
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
        status: expired ? 'expired' : 'completed',
        file: files[files.length - 1] ?? null, // legacy single-file readers
        files,
        expiresAt: session.expires_at,
        expiresIn,
      });
    }

    return NextResponse.json({
      success: true,
      status: expired ? 'expired' : 'waiting',
      files: [],
      expiresAt: session.expires_at,
      expiresIn,
    });
  } catch (error) {
    console.error('Check receive session error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
