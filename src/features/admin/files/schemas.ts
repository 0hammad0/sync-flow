import { z } from 'zod';
import { FILE_ID_RE, FILE_KINDS, MAX_FILES_PER_DELETE } from './constants';

// Server-side input and URL schemas for Files & storage (client components
// import ./constants instead, to keep zod out of the bundle). No name search, ever (D-6): the screen filters by kind and expiry only, and
// sorts by created date (newest first) only, the one order every source has
// an index for.

export { FILE_ID_RE, FILE_KINDS, MAX_FILES_PER_DELETE, TYPE_TO_CONFIRM_OVER, type FileKindParam } from './constants';

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
