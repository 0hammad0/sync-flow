import { z } from 'zod';

// Shared by the files table (client) and the files actions/queries (server).
// No name search, ever (D-6): the screen filters by kind and expiry only, and
// sorts by created date (newest first) only, the one order every source has
// an index for.

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
export const fileIdSchema = z.string().regex(FILE_ID_RE, 'Unknown file.');

const reasonSchema = z.string().trim().max(200, 'Keep the reason under 200 characters.').optional();

export const deleteFileSchema = z.object({ id: fileIdSchema, reason: reasonSchema });
export type DeleteFileInput = z.input<typeof deleteFileSchema>;

export const deleteFilesSchema = z.object({
  ids: z
    .array(fileIdSchema)
    .min(1, 'Select at least one file.')
    .max(MAX_FILES_PER_DELETE, `Select ${MAX_FILES_PER_DELETE} files or fewer.`),
  reason: reasonSchema,
});
export type DeleteFilesInput = z.input<typeof deleteFilesSchema>;

/**
 * URL params of /admin/files: `?kind&expired&cursor`. Unknown values fall
 * back to the defaults. `expired=1` lists share files past expiry (oldest
 * first), so it implies `kind=share`.
 */
export const filesParamsSchema = z.object({
  kind: z.enum(FILE_KINDS).catch('all'),
  expired: z
    .enum(['1'])
    .optional()
    .catch(undefined)
    .transform((v) => v === '1'),
  cursor: z.string().max(2000).optional().catch(undefined),
});
export type FilesParams = z.infer<typeof filesParamsSchema>;
