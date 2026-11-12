// Product limits shared by client forms and server checks. Pure constants
// (no Node or Firebase imports), so both sides can import this file.

/** Largest file any tool accepts (share, phone → PC, chat attachment). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** AES-GCM overhead added to an encrypted share upload: 12-byte IV + 16-byte tag. */
export const ENCRYPTION_OVERHEAD_BYTES = 28;

/** Highest "max downloads" a share link may have. */
export const MAX_DOWNLOADS = 1000;

/** Share-link expiry choices, in hours. `null` = never expires (signed-in only). */
export interface ExpiryOption {
  hours: number | null;
  label: string;
  /** Guests may pick it too. */
  guest: boolean;
}

export const SHARE_EXPIRY_OPTIONS: readonly ExpiryOption[] = [
  { hours: 1, label: '1 hour', guest: true },
  { hours: 24, label: '24 hours', guest: true },
  { hours: 168, label: '7 days', guest: true },
  { hours: 720, label: '30 days', guest: false },
  { hours: null, label: 'Never expires', guest: false },
];

export const DEFAULT_GUEST_EXPIRY_HOURS = 24;

/** True when `hours` is an expiry this kind of user may choose. */
export function isAllowedExpiry(hours: number | null, signedIn: boolean): boolean {
  return SHARE_EXPIRY_OPTIONS.some((o) => o.hours === hours && (signedIn || o.guest));
}

/** Phone → PC short code: no I, O, 0, 1 (easy to misread). */
export const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SHORT_CODE_LENGTH = 6;

/** Phone → PC: a guest receiver's files are kept this long, then /api/cleanup removes them. */
export const GUEST_RECEIVED_FILE_TTL_HOURS = 24;

/**
 * Phone → PC: how long a presigned PUT URL stays valid. A file presigned just
 * before the receive session expires can still land up to this long after it,
 * so the PC keeps listening for late files for this grace period.
 */
export const SEND_LATE_FILE_GRACE_MS = 15 * 60 * 1000;
