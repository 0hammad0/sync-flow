// Files & storage constants shared by client components and the zod schemas.
// Kept free of zod: client components import this file, and zod in a client
// bundle costs ~30 KiB gz of first-load JS.

export const FILE_KINDS = ['all', 'share', 'chat'] as const;
export type FileKindParam = (typeof FILE_KINDS)[number];

/** Bulk delete cap (09-files-and-storage.md "Delete many (≤ 100)"). Same as FileService.MAX_BULK_DELETE. */
export const MAX_FILES_PER_DELETE = 100;
/** Above this many files the dialog asks to type DELETE. */
export const TYPE_TO_CONFIRM_OVER = 10;

/**
 * Opaque admin file id (`f_` + base64url). Same pattern as FILE_ID_PATTERN in
 * src/server/files/file-id.ts (a unit test keeps them equal); repeated here
 * because this file is also bundled for the client.
 */
export const FILE_ID_RE = /^f_[A-Za-z0-9_-]{24,400}$/;
