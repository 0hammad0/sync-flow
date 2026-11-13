import { z } from 'zod';
import { PAGE_MODES, isKnownPath, type PageMode } from './constants';
import { sortForMode } from './rows';

// URL params of /admin/pages (05-pages.md "URL state"):
// `?range&q&mode=all&sort=-pageviews&cursor&path=`. The range keys are read
// by range-schema.ts. Never fails: anything unusable falls back silently.

const first = z.unknown().transform((v): unknown => (Array.isArray(v) ? v[0] : v));
const text = (max: number) => first.transform((v) => (typeof v === 'string' ? v.trim().slice(0, max) : ''));

export const MAX_PATH_QUERY = 200;

const rawSchema = z.object({
  q: text(MAX_PATH_QUERY),
  mode: first.transform((v): PageMode => ((PAGE_MODES as readonly unknown[]).includes(v) ? (v as PageMode) : 'all')),
  sort: text(40),
  // Row offset of the in-memory list, written by the table as "25", "50" …
  cursor: first.transform((v) => {
    const n = typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : 0;
    return Number.isSafeInteger(n) ? n : 0;
  }),
  path: text(MAX_PATH_QUERY),
});

export type PagesParams = {
  q: string;
  mode: PageMode;
  sort: string;
  cursor: number;
  /** `?path=` as given (null when absent). Check it with `pathIsKnown`. */
  path: string | null;
  /** True when `path` is a tracked route pattern; false means "Unknown page." and no query. */
  pathIsKnown: boolean;
};

/** Every key made present first: zod 4 skips the transform of a missing key. */
function withKeys(input: unknown): Record<string, unknown> {
  const s = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return { q: s.q ?? null, mode: s.mode ?? null, sort: s.sort ?? null, cursor: s.cursor ?? null, path: s.path ?? null };
}

export const pagesParamsSchema = z.preprocess(withKeys, rawSchema).transform(
  (raw): PagesParams => ({
    q: raw.q,
    mode: raw.mode,
    sort: sortForMode(raw.mode, raw.sort),
    cursor: raw.cursor,
    path: raw.path || null,
    pathIsKnown: isKnownPath(raw.path),
  }),
);

/** Next.js `searchParams` → PagesParams. */
export function parsePagesParams(search: Record<string, string | string[] | undefined> | null | undefined): PagesParams {
  return pagesParamsSchema.parse(search ?? {});
}
