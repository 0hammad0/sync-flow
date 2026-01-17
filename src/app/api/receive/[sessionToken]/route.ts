import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// GET - Check receive session status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionToken: string }> }
) {
  try {
    const { sessionToken } = await params;
    const serviceClient = createServiceClient();

    // Get session
    const { data: session, error } = await serviceClient
      .from('receive_sessions')
      .select('*')
      .eq('session_token', sessionToken)
      .single();

    if (error || !session) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }

    // Check if expired
    if (new Date(session.expires_at) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'Session expired' },
        { status: 410 }
      );
    }

    // Check if file has been uploaded
    if (session.file_token) {
      // Get file info
      const { data: file } = await serviceClient
        .from('files')
        .select('original_name, size, mime_type, token, is_encrypted')
        .eq('token', session.file_token)
        .single();

      return NextResponse.json({
        success: true,
        status: 'completed',
        file: file ? {
          name: file.original_name,
          size: file.size,
          mimeType: file.mime_type,
          token: file.token,
          isEncrypted: file.is_encrypted,
        } : null,
      });
    }

    // Still waiting
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
