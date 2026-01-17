'use server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { generateToken, sanitizeFileName, getBaseUrl } from '@/lib/utils';
import { UploadResult, DownloadInfo, FileRecord } from '@/types';

const BUCKET_NAME = process.env.STORAGE_BUCKET || 'file-transfer-bucket';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const SIGNED_URL_EXPIRY = 3600; // 1 hour in seconds

export async function uploadFile(formData: FormData): Promise<UploadResult> {
  try {
    const file = formData.get('file') as File | null;

    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    if (file.size > MAX_FILE_SIZE) {
      return { success: false, error: 'File size exceeds 50MB limit' };
    }

    const supabase = await createClient();
    const serviceClient = createServiceClient();

    // Get current user (may be null for anonymous uploads)
    const { data: { user } } = await supabase.auth.getUser();

    // Generate unique token and file path
    const token = generateToken();
    const sanitizedName = sanitizeFileName(file.name);
    const filePath = `${token}/${sanitizedName}`;

    // Convert file to buffer for upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload file to Supabase Storage using service client
    const { error: uploadError } = await serviceClient.storage
      .from(BUCKET_NAME)
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      // Provide more specific error messages
      if (uploadError.message?.includes('bucket') || uploadError.message?.includes('not found')) {
        return { success: false, error: `Storage bucket "${BUCKET_NAME}" not found. Please create it in Supabase Dashboard.` };
      }
      return { success: false, error: `Storage error: ${uploadError.message}` };
    }

    // Insert metadata into database
    const { error: dbError } = await serviceClient
      .from('files')
      .insert({
        token,
        file_path: filePath,
        original_name: file.name,
        size: file.size,
        mime_type: file.type || 'application/octet-stream',
        owner_id: user?.id || null,
      });

    if (dbError) {
      console.error('Database error:', dbError);
      // Clean up uploaded file on DB failure
      await serviceClient.storage.from(BUCKET_NAME).remove([filePath]);
      // Provide more specific error messages
      if (dbError.message?.includes('relation') || dbError.code === '42P01') {
        return { success: false, error: 'Database table "files" not found. Please run the SQL setup script.' };
      }
      return { success: false, error: `Database error: ${dbError.message}` };
    }

    const shareUrl = `${getBaseUrl()}/share/${token}`;

    return { success: true, shareUrl, token };
  } catch (error) {
    console.error('Upload error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

export async function getFileByToken(token: string): Promise<DownloadInfo> {
  try {
    const serviceClient = createServiceClient();

    // Fetch file record from database
    const { data: fileRecord, error: dbError } = await serviceClient
      .from('files')
      .select('*')
      .eq('token', token)
      .single();

    if (dbError || !fileRecord) {
      return { success: false, error: 'File not found' };
    }

    const file = fileRecord as FileRecord;

    // Check if file has expired
    if (file.expires_at) {
      const expiryDate = new Date(file.expires_at);
      if (expiryDate < new Date()) {
        // Auto-delete expired anonymous files to free storage
        if (!file.owner_id) {
          await serviceClient.storage.from(BUCKET_NAME).remove([file.file_path]);
          await serviceClient.from('files').delete().eq('token', token);
        }
        return { success: false, error: 'expired' };
      }
    }

    // Check download limit
    if (file.max_downloads !== null && file.download_count >= file.max_downloads) {
      return { success: false, error: 'download_limit_reached' };
    }

    // Calculate downloads remaining
    const downloadsRemaining = file.max_downloads !== null
      ? file.max_downloads - file.download_count
      : null;

    // First verify the file actually exists in storage
    // (signed URLs can be generated for non-existent files)
    const { data: fileExists, error: existsError } = await serviceClient.storage
      .from(BUCKET_NAME)
      .createSignedUrl(file.file_path, 5); // Short-lived URL just to check

    if (existsError) {
      console.error('File existence check error:', existsError);
      // If file doesn't exist in storage, clean up the orphan database record
      if (existsError.message?.includes('not found') || existsError.message?.includes('Object')) {
        console.log(`Cleaning up orphan database record for token: ${token}`);
        await serviceClient.from('files').delete().eq('token', token);
      }
      return { success: false, error: 'File not found in storage' };
    }

    // Verify by attempting a HEAD request to the signed URL
    try {
      const headResponse = await fetch(fileExists.signedUrl, { method: 'HEAD' });
      if (!headResponse.ok) {
        console.error(`File not found in storage for token: ${token}, status: ${headResponse.status}`);
        // Clean up orphan database record
        await serviceClient.from('files').delete().eq('token', token);
        return { success: false, error: 'File not found in storage' };
      }
    } catch (fetchError) {
      console.error('Error verifying file existence:', fetchError);
      // Continue - the file might still be accessible
    }

    // Generate signed URL for download
    const { data: signedUrlData, error: signedUrlError } = await serviceClient.storage
      .from(BUCKET_NAME)
      .createSignedUrl(file.file_path, SIGNED_URL_EXPIRY, {
        download: file.is_encrypted ? undefined : file.original_name,
      });

    if (signedUrlError || !signedUrlData) {
      console.error('Signed URL error:', signedUrlError);
      return { success: false, error: 'Failed to generate download link' };
    }

    return {
      success: true,
      signedUrl: signedUrlData.signedUrl,
      fileName: file.original_name,
      fileSize: file.size,
      mimeType: file.mime_type,
      isEncrypted: file.is_encrypted,
      createdAt: file.created_at,
      expiresAt: file.expires_at,
      downloadsRemaining,
      token: file.token,
    };
  } catch (error) {
    console.error('Get file error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

export async function incrementDownloadCount(token: string): Promise<{ success: boolean; selfDestruct?: boolean; error?: string }> {
  try {
    const serviceClient = createServiceClient();

    // Call the RPC function to atomically increment download count
    const { data: newCount, error: rpcError } = await serviceClient
      .rpc('increment_download_count', { file_token: token });

    if (rpcError) {
      console.error('Increment download count error:', rpcError);
      return { success: false, error: 'Failed to update download count' };
    }

    // Check if we need to self-destruct (reached max downloads)
    const { data: fileRecord, error: fetchError } = await serviceClient
      .from('files')
      .select('max_downloads, file_path')
      .eq('token', token)
      .single();

    if (fetchError || !fileRecord) {
      return { success: true };
    }

    // If max downloads reached, delete the file
    if (fileRecord.max_downloads !== null && newCount >= fileRecord.max_downloads) {
      // Delete from storage
      await serviceClient.storage.from(BUCKET_NAME).remove([fileRecord.file_path]);

      // Delete from database
      await serviceClient.from('files').delete().eq('token', token);

      return { success: true, selfDestruct: true };
    }

    return { success: true };
  } catch (error) {
    console.error('Increment download count error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

export async function getUserFileCount(userId: string): Promise<number> {
  try {
    const serviceClient = createServiceClient();
    const { count, error } = await serviceClient
      .from('files')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', userId);

    if (error) {
      console.error('Get user file count error:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('Get user file count error:', error);
    return 0;
  }
}

export async function getUserFiles(): Promise<FileRecord[]> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return [];
    }

    const serviceClient = createServiceClient();
    const { data: files, error } = await serviceClient
      .from('files')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Get user files error:', error);
      return [];
    }

    return files as FileRecord[];
  } catch (error) {
    console.error('Get user files error:', error);
    return [];
  }
}

export async function reshareFile(
  token: string,
  expiresInHours: number | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const serviceClient = createServiceClient();

    // Fetch file record to verify ownership
    const { data: fileRecord, error: fetchError } = await serviceClient
      .from('files')
      .select('owner_id')
      .eq('token', token)
      .single();

    if (fetchError || !fileRecord) {
      return { success: false, error: 'File not found' };
    }

    if (fileRecord.owner_id !== user.id) {
      return { success: false, error: 'Not authorized to modify this file' };
    }

    // Calculate new expiry time
    let expiresAt: string | null = null;
    if (expiresInHours && expiresInHours > 0) {
      const expiryDate = new Date();
      expiryDate.setHours(expiryDate.getHours() + expiresInHours);
      expiresAt = expiryDate.toISOString();
    }

    // Update the file's expiry
    const { error: updateError } = await serviceClient
      .from('files')
      .update({ expires_at: expiresAt })
      .eq('token', token);

    if (updateError) {
      console.error('Update expiry error:', updateError);
      return { success: false, error: 'Failed to update file expiry' };
    }

    return { success: true };
  } catch (error) {
    console.error('Reshare file error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

export async function deleteFile(token: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const serviceClient = createServiceClient();

    // Fetch file record to verify ownership
    const { data: fileRecord, error: fetchError } = await serviceClient
      .from('files')
      .select('*')
      .eq('token', token)
      .single();

    if (fetchError || !fileRecord) {
      return { success: false, error: 'File not found' };
    }

    const file = fileRecord as FileRecord;

    if (file.owner_id !== user.id) {
      return { success: false, error: 'Not authorized to delete this file' };
    }

    // Delete from storage first
    const { error: storageError } = await serviceClient.storage
      .from(BUCKET_NAME)
      .remove([file.file_path]);

    if (storageError) {
      console.error('Storage delete error:', storageError);
      return { success: false, error: 'Failed to delete file from storage' };
    }

    // Delete from database only after storage deletion succeeds
    const { error: dbError } = await serviceClient
      .from('files')
      .delete()
      .eq('token', token);

    if (dbError) {
      console.error('Database delete error:', dbError);
      return { success: false, error: 'Failed to delete file record' };
    }

    return { success: true };
  } catch (error) {
    console.error('Delete file error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}
