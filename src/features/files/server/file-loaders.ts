import 'server-only';

import { DownloadInfo, FileRecord } from '@/types';
import { currentUser } from '@/shared/lib/firebase/session';
import { getFile, deleteFile as fsDeleteFile, listOwnerFiles, deleteIfSpent } from '@/shared/lib/firebase/files';
import { deleteObject, objectExists, signedDownloadUrl } from '@/shared/lib/r2';

// Plain server functions for page renders. Pages call these, never the
// 'use server' exports in files.ts, so a page view is never blocked [T-27]:
// the block check lives only in the 'use server' wrappers (access-control
// spec step 6, option (a)). Not callable from the browser.

// Signed URLs are handed out per click, after the download is counted, so
// they only need to live long enough to start the transfer.
export const SIGNED_URL_EXPIRY = 300; // 5 minutes
// getFileByToken's URL (unlimited files only — nothing to bypass). The
// receive page fetches several files with it in one go, so keep it longer.
const PAGE_URL_EXPIRY = 3600; // 1 hour

/** Delete a used-up file once its last signed URL has had time to finish. */
export async function sweepIfSpent(token: string, minAgeMs: number): Promise<boolean> {
  const path = await deleteIfSpent(token, minAgeMs);
  if (!path) return false;
  await deleteObject(path).catch((err) =>
    console.error('R2 delete after self-destruct failed:', err)
  );
  return true;
}

export async function loadFileByToken(token: string): Promise<DownloadInfo> {
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

export async function loadUserFiles(): Promise<FileRecord[]> {
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
