import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generateToken, sanitizeFileName } from '@/lib/utils';

const BUCKET_NAME = process.env.STORAGE_BUCKET || 'file-transfers';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get('file') as Blob | null;
    const originalName = formData.get('originalName') as string | null;
    const mimeType = formData.get('mimeType') as string | null;
    const sessionToken = formData.get('sessionToken') as string | null;

    if (!file || !originalName || !sessionToken) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'File size exceeds 50MB limit' },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();

    // Verify session exists and is not expired
    const { data: session, error: sessionError } = await serviceClient
      .from('receive_sessions')
      .select('*')
      .eq('session_token', sessionToken)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }

    if (new Date(session.expires_at) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'Session expired' },
        { status: 410 }
      );
    }

    if (session.file_token) {
      return NextResponse.json(
        { success: false, error: 'Session already has a file' },
        { status: 400 }
      );
    }

    // Generate unique token and file path
    const fileToken = generateToken();
    const sanitizedName = sanitizeFileName(originalName);
    const filePath = `${fileToken}/${sanitizedName}`;

    // Convert blob to buffer for upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload file to Supabase Storage
    const { error: uploadError } = await serviceClient.storage
      .from(BUCKET_NAME)
      .upload(filePath, buffer, {
        contentType: mimeType || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json(
        { success: false, error: 'Failed to upload file' },
        { status: 500 }
      );
    }

    // Insert file metadata
    const { error: dbError } = await serviceClient
      .from('files')
      .insert({
        token: fileToken,
        file_path: filePath,
        original_name: originalName,
        size: file.size,
        mime_type: mimeType || 'application/octet-stream',
        owner_id: null, // Anonymous upload
        is_encrypted: false,
      });

    if (dbError) {
      console.error('Database error:', dbError);
      // Clean up uploaded file
      await serviceClient.storage.from(BUCKET_NAME).remove([filePath]);
      return NextResponse.json(
        { success: false, error: 'Failed to save file metadata' },
        { status: 500 }
      );
    }

    // Update receive session with file token
    const { error: updateError } = await serviceClient
      .from('receive_sessions')
      .update({ file_token: fileToken })
      .eq('session_token', sessionToken);

    if (updateError) {
      console.error('Update session error:', updateError);
      // File is uploaded, but session update failed - not critical
    }

    return NextResponse.json({
      success: true,
      token: fileToken,
    });
  } catch (error) {
    console.error('Send error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
