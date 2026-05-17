import { NextRequest, NextResponse } from 'next/server';
import { getFile, getReceiveSession } from '@/lib/firebase/files';

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

    if (session.file_token) {
      const file = await getFile(session.file_token);
      return NextResponse.json({
        success: true,
        status: 'completed',
        file: file
          ? {
              name: file.original_name,
              size: file.size,
              mimeType: file.mime_type,
              token: file.token,
              isEncrypted: file.is_encrypted,
            }
          : null,
      });
    }

    return NextResponse.json({
      success: true,
      status: 'waiting',
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
