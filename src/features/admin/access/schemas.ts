import { z } from 'zod';
import { BLOCK_DURATIONS, BLOCK_STATUSES, BLOCK_TYPES, REASON_MAX, REASON_MIN } from '@/shared/lib/block-values';

// Shared by the block dialog (client) and the access actions (server).
// Value rules (normalising, hard stops, warnings) live in
// src/shared/lib/block-values.ts; this only shapes the input.

export { BLOCK_STATUSES, type BlockStatusParam } from '@/shared/lib/block-values';

export const blockSubjectSchema = z.object({
  type: z.enum(BLOCK_TYPES),
  value: z.string().trim().min(1, 'Enter a value.').max(320),
  reason: z
    .string()
    .trim()
    .min(REASON_MIN, 'Add a reason (at least 3 characters).')
    .max(REASON_MAX, `Keep the reason under ${REASON_MAX} characters.`),
  duration: z.enum(BLOCK_DURATIONS),
  acknowledged: z.boolean().default(false),
  confirm: z.string().trim().max(64).optional(),
});
export type BlockSubjectInput = z.input<typeof blockSubjectSchema>;

export const unblockSubjectSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9]{1,40}$/, 'Unknown block.'),
});
export type UnblockSubjectInput = z.input<typeof unblockSubjectSchema>;

/** URL params of /admin/access. Unknown values fall back to the defaults. */
export const accessParamsSchema = z.object({
  status: z.enum(BLOCK_STATUSES).catch('active'),
  type: z.enum(BLOCK_TYPES).optional().catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
});
export type AccessParams = z.infer<typeof accessParamsSchema>;
