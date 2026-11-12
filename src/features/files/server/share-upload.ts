// Shared server logic for "Share a file" uploads. Used by the direct-to-R2
// flow (/api/upload/presign + /api/upload/complete) and by the legacy
// multipart POST /api/upload, so both apply exactly the same rules.

import { NextResponse } from 'next/server';
import { generateToken, sanitizeFileName, MAX_USER_FILES } from '@/shared/lib/utils';
import {
  DEFAULT_GUEST_EXPIRY_HOURS,
  MAX_DOWNLOADS,
  MAX_UPLOAD_BYTES,
  isAllowedExpiry,
} from '@/shared/lib/limits';
import { countOwnerFiles, createFileWithinCap } from '@/shared/lib/firebase/files';
import { deleteObject } from '@/shared/lib/r2';

const LIMIT_REACHED_MESSAGE = `You've reached the limit of ${MAX_USER_FILES} files. Please delete some files from your dashboard to upload more.`;

/** Same body and status for the per-user cap, at presign and at complete. */
function limitReachedResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: LIMIT_REACHED_MESSAGE, limitReached: true },
    { status: 400 }
  );
}

/** Empty form/JSON values mean "not chosen". */
function isUnset(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

export interface ShareUploadPlan {
  token: string;
  key: string;
  name: string;
  mime: string; // the file's real type, shown to the downloader
  storedType: string; // Content-Type stored in R2
  size: number;
  enc: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  owner: string | null;
}

/** Validate an upload request. Returns the approved plan or an error response. */
export async function planShareUpload(input: {
  originalName: unknown;
  mimeType: unknown;
  size: unknown;
  isEncrypted: boolean;
  expiresInHours: unknown;
  maxDownloads: unknown;
  ownerId: string | null;
  /**
   * The form showed signed-in options. If the session cookie has expired
   * (ownerId null) we refuse instead of quietly making a 24h guest file.
   */
  asMember?: boolean;
}): Promise<{ plan: ShareUploadPlan } | { error: NextResponse }> {
  const fail = (error: string, status = 400, extra: object = {}) => ({
    error: NextResponse.json({ success: false, error, ...extra }, { status }),
  });

  if (input.asMember && !input.ownerId) {
    return fail('Your sign-in has expired. Please sign in again to keep files in My Files.', 401, {
      signInRequired: true,
    });
  }

  const name = typeof input.originalName === 'string' ? input.originalName : '';
  if (!name) return fail('Original file name required');
  const size = Number(input.size);
  if (!Number.isInteger(size) || size < 0) return fail('No file provided');
  if (size > MAX_UPLOAD_BYTES) return fail('File size exceeds 100MB limit');

  // Only the choices the upload form offers (SHARE_EXPIRY_OPTIONS). Guests
  // can't pick "never" or 30 days — enforced here, not just in the browser.
  // An unset value means "never" for a member and the default for a guest;
  // anything else that isn't allowed is refused, never silently changed.
  const signedIn = !!input.ownerId;
  let expiresInHours: number | null;
  if (isUnset(input.expiresInHours)) {
    expiresInHours = signedIn ? null : DEFAULT_GUEST_EXPIRY_HOURS;
  } else {
    const hours = Number(input.expiresInHours);
    if (!Number.isInteger(hours) || !isAllowedExpiry(hours, signedIn)) {
      return fail(
        signedIn
          ? 'That expiry option is not available.'
          : 'That expiry option needs a signed-in account. Pick 1 hour, 24 hours or 7 days, or sign in.'
      );
    }
    expiresInHours = hours;
  }

  // Unset = unlimited. Otherwise a whole number from 1 to MAX_DOWNLOADS, the
  // same rule the upload form shows; anything else is refused.
  let maxDownloads: number | null = null;
  if (!isUnset(input.maxDownloads)) {
    const n = Number(input.maxDownloads);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DOWNLOADS) {
      return fail(`Max downloads must be a whole number from 1 to ${MAX_DOWNLOADS}, or empty for unlimited.`);
    }
    maxDownloads = n;
  }
  const expiresAt =
    expiresInHours !== null ? new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString() : null;

  if (input.ownerId && (await countOwnerFiles(input.ownerId)) >= MAX_USER_FILES) {
    return { error: limitReachedResponse() };
  }

  const mime =
    typeof input.mimeType === 'string' && input.mimeType ? input.mimeType : 'application/octet-stream';
  const token = generateToken();
  return {
    plan: {
      token,
      key: `${token}/${sanitizeFileName(name)}`,
      name,
      mime,
      storedType: input.isEncrypted ? 'application/octet-stream' : mime,
      size,
      enc: input.isEncrypted,
      expiresAt,
      maxDownloads,
      owner: input.ownerId,
    },
  };
}

/** Write the metadata record for an object already stored in R2. Rolls the object back on failure. */
export async function finishShareUpload(plan: ShareUploadPlan, origin: string): Promise<NextResponse> {
  // Checked again here: presign only checks the count at that moment, so
  // several presigns made before any complete could otherwise all land.
  // The check and the write share one transaction (with a per-owner lock),
  // so two completes at the same instant can't both pass.
  let ok: boolean;
  try {
    const result = await createFileWithinCap(
      {
        token: plan.token,
        file_path: plan.key,
        original_name: plan.name,
        size: plan.size,
        mime_type: plan.mime,
        owner_id: plan.owner,
        is_encrypted: plan.enc,
        expires_at: plan.expiresAt,
        max_downloads: plan.maxDownloads,
      },
      MAX_USER_FILES
    );
    ok = result.ok;
  } catch (err) {
    console.error('Firestore write error:', err);
    // Roll back the R2 upload so we don't leave an orphan blob.
    await deleteObject(plan.key).catch(() => {});
    return NextResponse.json(
      { success: false, error: 'Failed to save the file. Please try again.' },
      { status: 500 }
    );
  }
  if (!ok) {
    await deleteObject(plan.key).catch(() => {});
    return limitReachedResponse();
  }
  return NextResponse.json({ success: true, shareUrl: `${origin}/share/${plan.token}`, token: plan.token });
}
