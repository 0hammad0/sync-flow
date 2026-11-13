import type { FileType } from './format';

// DTOs for Files & storage (06-coding-standards.md "DTO"). Dates are ISO
// strings: they cross the server/client boundary and the Next cache.
// D-6: no file name. D-4: no storage key, URL, token or content.

export type FileKind = 'share' | 'chat';

export type FileUploaderDto = {
  /** `sara@example.com`, `Ali (guest)`, `Guest`, `Signed-in user` or `Deleted user`. */
  label: string;
  /** Firebase uid when signed in, else null. */
  uid: string | null;
};

/** One row of the files table, and the drawer's data. */
export type FileRowDto = {
  /** Opaque `f_…` id. Never a share token. */
  id: string;
  kind: FileKind;
  type: FileType;
  /** Stored mime type, e.g. `application/pdf`. Shown in the drawer only. */
  mimeType: string;
  size: number;
  createdAt: string;
  uploader: FileUploaderDto;
  /** Chat only. */
  roomCode: string | null;
  /** Share only. Chat rows: null (room expiry is on the Rooms screen). */
  expiresAt: string | null;
  downloads: number | null;
  maxDownloads: number | null;
  isEncrypted: boolean;
  voiceDurationMs: number | null;
};

export type StorageBytesDto = { count: number; bytes: number };

export type BucketDto =
  | { state: 'ok'; objectCount: number; payloadBytes: number; limitBytes: number; measuredAt: string }
  /** CF_ACCOUNT_ID / CF_API_TOKEN not set. */
  | { state: 'not_configured' }
  | { state: 'error'; errorId: string };

export type StorageSummaryDto = {
  bucket: BucketDto;
  /** Firestore `files` aggregate (count + sum of size). */
  share: StorageBytesDto | null;
  /** R2 prefix `chat/` (objects + bytes), cached. null when it failed. */
  chat: { objects: number; bytes: number } | null;
  /** Signed-in users' share files past expiry, kept on purpose (D-7). */
  notSwept: StorageBytesDto | null;
};
