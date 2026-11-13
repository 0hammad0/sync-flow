import { z } from 'zod';
import { isIsoDay, isRangeKind, type RangeParams } from './range';

// Zod schema for the shared `?range` / `?from` / `?to` params. Kept apart from
// range.ts so the client picker does not bundle zod. Never fails: anything
// unusable becomes null, and resolveRange then falls back to 7d.

const first = z.unknown().transform((v): unknown => (Array.isArray(v) ? v[0] : v));
const rangeField = first.transform((v) => (isRangeKind(v) ? v : null));
const dayField = first.transform((v) => (typeof v === 'string' && isIsoDay(v.trim()) ? v.trim() : null));

/** Every key made present first: zod 4 skips the transform of a missing key. */
function withKeys(input: unknown): Record<'range' | 'from' | 'to', unknown> {
  const s = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return { range: s.range ?? null, from: s.from ?? null, to: s.to ?? null };
}

export const rangeParamsSchema = z
  .preprocess(withKeys, z.object({ range: rangeField, from: dayField, to: dayField }))
  .catch({ range: null, from: null, to: null });

/** Next.js `searchParams` (or any record) → RangeParams. */
export function parseRangeParams(search: Record<string, string | string[] | undefined> | null | undefined): RangeParams {
  return rangeParamsSchema.parse(search);
}
