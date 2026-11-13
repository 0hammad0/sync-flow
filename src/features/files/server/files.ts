'use server';

import { DownloadInfo, FileRecord } from '@/types';
import { currentUser } from '@/shared/lib/firebase/session';
import {
  getFile,
  deleteFile as fsDeleteFile,
  countOwnerFiles,
  updateFileExpiry,
  claimDownload,
} from '@/shared/lib/firebase/files';
import {
  deleteObject,
  objectExists,
  signedDownloadUrl,
} from '@/shared/lib/r2';
import { isAllowedExpiry } from '@/shared/lib/limits';
import { assertNotBlocked, blockedActionResult } from '@/server/blocklist/assert-not-blocked';
import { loadFileByToken, loadUserFiles, SIGNED_URL_EXPIRY, sweepIfSpent } from './file-loaders';

// Every export here is a server action: a POST the browser can make. Each one
// re-checks the visitor blocklist first (T-27, T-6 style). Page renders must
// NOT call these: they use the plain loaders in ./file-loaders, so a blocked
// visitor can still open every page (access-control spec step 6, option (a)).

export async function getFileByToken(token: string): Promise<DownloadInfo> {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedActionResult(blocked);
  return loadFileByToken(token);
}

export interface DownloadGrant {
  success: boolean;
  signedUrl?: string;
  downloadsRemaining?: number | null;
  /** True when this download used up the limit — call finishDownload() after. */
  lastDownload?: boolean;
  error?: string;
  /** Support reference when `error` is `blocked`. */
  ref?: string;
}

/**
 * Count one download, then return a short-lived signed URL. Refuses once the
 * limit is reached or the link has expired.
 */
export async function requestDownload(token: string): Promise<DownloadGrant> {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedActionResult(blocked);
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
  const blocked = await assertNotBlocked();
  if (blocked) return { success: false };
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
export async function requestPreview(token: string): Promise<{ success: boolean; signedUrl?: string; error?: string; ref?: string }> {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedActionResult(blocked);
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
  const blocked = await assertNotBlocked();
  if (blocked) return 0;
  try {
    return await countOwnerFiles(userId);
  } catch (error) {
    console.error('Get user file count error:', error);
    return 0;
  }
}

/** Client-callable copy of the dashboard list. The dashboard page renders with loadUserFiles(). */
export async function getUserFiles(): Promise<FileRecord[]> {
  const blocked = await assertNotBlocked();
  // A list cannot carry `error: 'blocked'`; an empty list says nothing about the block.
  if (blocked) return [];
  return loadUserFiles();
}

export async function reshareFile(
  token: string,
  expiresInHours: number | null
): Promise<{ success: boolean; error?: string; ref?: string }> {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedActionResult(blocked);
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

export async function deleteFile(token: string): Promise<{ success: boolean; error?: string; ref?: string }> {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedActionResult(blocked);
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
