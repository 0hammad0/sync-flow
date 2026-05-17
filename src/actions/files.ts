'use server';

import { DownloadInfo, FileRecord } from '@/types';
import { currentUser } from '@/lib/firebase/session';
import {
  getFile,
  deleteFile as fsDeleteFile,
  listOwnerFiles,
  countOwnerFiles,
  updateFileExpiry,
  incrementDownloadAndMaybeDestruct,
} from '@/lib/firebase/files';
import {
  deleteObject,
  objectExists,
  signedDownloadUrl,
} from '@/lib/r2';

const SIGNED_URL_EXPIRY = 3600; // 1 hour

export async function getFileByToken(token: string): Promise<DownloadInfo> {
  try {
    const file = await getFile(token);
    if (!file) return { success: false, error: 'File not found' };

    // Expiry
    if (file.expires_at) {
      const expired = new Date(file.expires_at) < new Date();
      if (expired) {
        // Auto-delete anonymous expired files to free storage
        if (!file.owner_id) {
          await Promise.allSettled([
            deleteObject(file.file_path),
            fsDeleteFile(token),
          ]);
        }
        return { success: false, error: 'expired' };
      }
    }

    // Download limit
    if (file.max_downloads !== null && file.download_count >= file.max_downloads) {
      return { success: false, error: 'download_limit_reached' };
    }

    // Verify object actually exists in R2 (cleans up orphan DB rows)
    const exists = await objectExists(file.file_path);
    if (!exists) {
      await fsDeleteFile(token).catch(() => {});
      return { success: false, error: 'File not found in storage' };
    }

    const signedUrl = await signedDownloadUrl(file.file_path, SIGNED_URL_EXPIRY, {
      downloadFilename: file.is_encrypted ? undefined : file.original_name,
    });

    const downloadsRemaining =
      file.max_downloads !== null ? file.max_downloads - file.download_count : null;

    return {
      success: true,
      signedUrl,
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

export async function incrementDownloadCount(
  token: string
): Promise<{ success: boolean; selfDestruct?: boolean; error?: string }> {
  try {
    const result = await incrementDownloadAndMaybeDestruct(token);
    if (result.selfDestruct && result.filePath) {
      // Best-effort R2 delete; the Firestore doc is already gone from the txn.
      await deleteObject(result.filePath).catch((err) =>
        console.error('R2 delete after self-destruct failed:', err)
      );
      return { success: true, selfDestruct: true };
    }
    return { success: true };
  } catch (error) {
    console.error('Increment download count error:', error);
    return { success: false, error: 'Failed to update download count' };
  }
}

export async function getUserFileCount(userId: string): Promise<number> {
  try {
    return await countOwnerFiles(userId);
  } catch (error) {
    console.error('Get user file count error:', error);
    return 0;
  }
}

export async function getUserFiles(): Promise<FileRecord[]> {
  try {
    const user = await currentUser();
    if (!user) return [];
    return await listOwnerFiles(user.uid);
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
    const user = await currentUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const file = await getFile(token);
    if (!file) return { success: false, error: 'File not found' };
    if (file.owner_id !== user.uid) {
      return { success: false, error: 'Not authorized to modify this file' };
    }

    let expires_at: string | null = null;
    if (expiresInHours && expiresInHours > 0) {
      expires_at = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
    }
    await updateFileExpiry(token, expires_at);
    return { success: true };
  } catch (error) {
    console.error('Reshare file error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

export async function deleteFile(token: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await currentUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const file = await getFile(token);
    if (!file) return { success: false, error: 'File not found' };
    if (file.owner_id !== user.uid) {
      return { success: false, error: 'Not authorized to delete this file' };
    }

    // Storage first, then DB. If storage delete fails, leave DB intact so the user can retry.
    await deleteObject(file.file_path);
    await fsDeleteFile(token);
    return { success: true };
  } catch (error) {
    console.error('Delete file error:', error);
    return { success: false, error: 'Failed to delete file' };
  }
}
