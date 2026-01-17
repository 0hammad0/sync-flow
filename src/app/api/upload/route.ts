import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { generateToken, sanitizeFileName, getBaseUrl, MAX_USER_FILES } from '@/lib/utils';
import { getUserFileCount } from '@/actions/files';

const BUCKET_NAME = process.env.STORAGE_BUCKET || 'file-transfer-bucket';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

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
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!originalName) {
      return NextResponse.json(
        { success: false, error: 'Original file name required' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'File size exceeds 50MB limit' },
        { status: 400 }
      );
    }

    // Parse optional fields
    const expiresInHours = expiresInHoursStr ? parseInt(expiresInHoursStr, 10) : null;
    const maxDownloads = maxDownloadsStr ? parseInt(maxDownloadsStr, 10) : null;

    // Calculate expiry time
    let expiresAt: string | null = null;
    if (expiresInHours && expiresInHours > 0) {
      const expiryDate = new Date();
      expiryDate.setHours(expiryDate.getHours() + expiresInHours);
      expiresAt = expiryDate.toISOString();
    }

    const supabase = await createClient();
    const serviceClient = createServiceClient();

    // Get current user (may be null for anonymous uploads)
    const { data: { user } } = await supabase.auth.getUser();

    // Check file limit for authenticated users
    if (user) {
      const fileCount = await getUserFileCount(user.id);
      if (fileCount >= MAX_USER_FILES) {
        return NextResponse.json(
          {
            success: false,
            error: `You've reached the limit of ${MAX_USER_FILES} files. Please delete some files from your dashboard to upload more.`,
            limitReached: true
          },
          { status: 400 }
        );
      }
    }

    // Generate unique token and file path
    const token = generateToken();
    const sanitizedName = sanitizeFileName(originalName);
    const filePath = `${token}/${sanitizedName}`;

    // Convert blob to buffer for upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload file to Supabase Storage using service client
    const { error: uploadError } = await serviceClient.storage
      .from(BUCKET_NAME)
      .upload(filePath, buffer, {
        contentType: isEncrypted ? 'application/octet-stream' : (mimeType || 'application/octet-stream'),
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      if (uploadError.message?.includes('bucket') || uploadError.message?.includes('not found')) {
        return NextResponse.json(
          { success: false, error: `Storage bucket "${BUCKET_NAME}" not found. Please create it in Supabase Dashboard.` },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { success: false, error: `Storage error: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Insert metadata into database
    const { error: dbError } = await serviceClient
      .from('files')
      .insert({
        token,
        file_path: filePath,
        original_name: originalName,
        size: file.size,
        mime_type: mimeType || 'application/octet-stream',
        owner_id: user?.id || null,
        is_encrypted: isEncrypted,
        expires_at: expiresAt,
        max_downloads: maxDownloads,
        download_count: 0,
      });

    if (dbError) {
      console.error('Database error:', dbError);
      // Clean up uploaded file on DB failure
      await serviceClient.storage.from(BUCKET_NAME).remove([filePath]);

      if (dbError.message?.includes('relation') || dbError.code === '42P01') {
        return NextResponse.json(
          { success: false, error: 'Database table "files" not found. Please run the SQL setup script.' },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { success: false, error: `Database error: ${dbError.message}` },
        { status: 500 }
      );
    }

    const shareUrl = `${getBaseUrl()}/share/${token}`;

    return NextResponse.json({ success: true, shareUrl, token });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
