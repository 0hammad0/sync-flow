'use server';

import { DownloadInfo, FileRecord } from '@/types';
import { currentUser } from '@/shared/lib/firebase/session';
import {
  getFile,
  deleteFile as fsDeleteFile,
  listOwnerFiles,
  countOwnerFiles,
  updateFileExpiry,
  claimDownload,
  deleteIfSpent,
} from '@/shared/lib/firebase/files';
import {
  deleteObject,
  objectExists,
  signedDownloadUrl,
} from '@/shared/lib/r2';
import { isAllowedExpiry } from '@/shared/lib/limits';

// Signed URLs are handed out per click, after the download is counted, so
// they only need to live long enough to start the transfer.
const SIGNED_URL_EXPIRY = 300; // 5 minutes
// getFileByToken's URL (unlimited files only — nothing to bypass). The
// receive page fetches several files with it in one go, so keep it longer.
const PAGE_URL_EXPIRY = 3600; // 1 hour

/** Delete a used-up file once its last signed URL has had time to finish. */
async function sweepIfSpent(token: string, minAgeMs: number): Promise<boolean> {
  const path = await deleteIfSpent(token, minAgeMs);
  if (!path) return false;
  await deleteObject(path).catch((err) =>
    console.error('R2 delete after self-destruct failed:', err)
  );
  return true;
}

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
      await sweepIfSpent(token, SIGNED_URL_EXPIRY * 1000).catch(() => {});
      return { success: false, error: 'download_limit_reached' };
    }

    // Verify object actually exists in R2 (cleans up orphan DB rows)
    const exists = await objectExists(file.file_path);
    if (!exists) {
      await fsDeleteFile(token).catch(() => {});
      return { success: false, error: 'File not found in storage' };
    }

    // Only unlimited files get a URL up front (the receive page uses it).
    // Limited files must go through requestDownload(), which counts first.
    const signedUrl =
      file.max_downloads === null
        ? await signedDownloadUrl(file.file_path, PAGE_URL_EXPIRY, {
            downloadFilename: file.is_encrypted ? undefined : file.original_name,
          })
        : undefined;

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

export interface DownloadGrant {
  success: boolean;
  signedUrl?: string;
  downloadsRemaining?: number | null;
  /** True when this download used up the limit — call finishDownload() after. */
  lastDownload?: boolean;
  error?: string;
}

/**
 * Count one download, then return a short-lived signed URL. Refuses once the
 * limit is reached or the link has expired.
 */
export async function requestDownload(token: string): Promise<DownloadGrant> {
  try {
    if (typeof token !== 'string' || !token) return { success: false, error: 'not_found' };
    const file = await getFile(token);
    if (!file) return { success: false, error: 'not_found' };

    // Check storage before counting, so a missing object doesn't burn a download.
    if (!(await objectExists(file.file_path))) {
      await fsDeleteFile(token).catch(() => {});
      return { success: false, error: 'not_found' };
    }

    const claim = await claimDownload(token);
    if (claim.status !== 'ok') {
      const error =
        claim.status === 'expired'
          ? 'expired'
          : claim.status === 'limit'
          ? 'download_limit_reached'
          : 'not_found';
      return { success: false, error };
    }

    const signedUrl = await signedDownloadUrl(file.file_path, SIGNED_URL_EXPIRY, {
      downloadFilename: file.is_encrypted ? undefined : file.original_name,
    });
    return {
      success: true,
      signedUrl,
      downloadsRemaining:
        file.max_downloads !== null ? Math.max(0, file.max_downloads - claim.newCount) : null,
      lastDownload: claim.spent,
    };
  } catch (error) {
    console.error('Request download error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Called by the client after the last allowed download finished: deletes the
 * file now instead of waiting for the sweep. Only acts on used-up files.
 */
export async function finishDownload(token: string): Promise<{ success: boolean; deleted?: boolean }> {
  try {
    if (typeof token !== 'string' || !token) return { success: false };
    return { success: true, deleted: await sweepIfSpent(token, 0) };
  } catch (error) {
    console.error('Finish download error:', error);
    return { success: false };
  }
}

/**
 * Signed URL for an in-page preview. Only for files without a download limit —
 * a preview of a limited file would be a free, uncounted download.
 */
export async function requestPreview(token: string): Promise<{ success: boolean; signedUrl?: string; error?: string }> {
  try {
    if (typeof token !== 'string' || !token) return { success: false, error: 'not_found' };
    const file = await getFile(token);
    if (!file) return { success: false, error: 'not_found' };
    if (file.expires_at && new Date(file.expires_at) < new Date()) {
      return { success: false, error: 'expired' };
    }
    if (file.max_downloads !== null) return { success: false, error: 'limited' };
    const signedUrl = await signedDownloadUrl(file.file_path, SIGNED_URL_EXPIRY);
    return { success: true, signedUrl };
  } catch (error) {
    console.error('Request preview error:', error);
    return { success: false, error: 'An unexpected error occurred' };
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
    const files = await listOwnerFiles(user.uid);
    // Self-destruct files whose limit was used up (and whose last URL is stale).
    const swept = await Promise.all(
      files.map((f) =>
        f.max_downloads !== null && f.download_count >= f.max_downloads
          ? sweepIfSpent(f.token, SIGNED_URL_EXPIRY * 1000).catch(() => false)
          : Promise.resolve(false)
      )
    );
    return files.filter((_, i) => !swept[i]);
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
    // Server actions take any value from the client: only the "Set expiry"
    // choices a signed-in user is offered (null = never).
    if (!isAllowedExpiry(expiresInHours, true)) {
      return { success: false, error: 'That expiry option is not available' };
    }

    const file = await getFile(token);
    if (!file) return { success: false, error: 'File not found' };
    if (file.owner_id !== user.uid) {
      return { success: false, error: 'Not authorized to modify this file' };
    }

    const expires_at =
      expiresInHours !== null ? new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString() : null;
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
