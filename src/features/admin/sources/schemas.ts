import { z } from 'zod';
import { DRILL_PARAM, SOURCE_SORT, SOURCE_TABS, UTM_FIELDS, type SourceTab, type UtmField } from './constants';

// URL params of /admin/sources (08-sources.md "URL state"):
// `?tab&utm=source&range&sort=-visitors&cursor&host=` (+ `browser=` for the
// browser versions drill). Never fails: unknown `tab` → referrers, unknown
// `utm` → source, a drill param on the wrong tab is dropped.

const first = z.unknown().transform((v): unknown => (Array.isArray(v) ? v[0] : v));
const text = (max: number) => first.transform((v) => (typeof v === 'string' ? v.trim().slice(0, max) : ''));
const oneOf = <T extends string>(values: readonly T[], fallback: T) =>
  first.transform((v): T => ((values as readonly unknown[]).includes(v) ? (v as T) : fallback));

const rawSchema = z.object({
  tab: oneOf(SOURCE_TABS, 'referrers'),
  utm: oneOf(UTM_FIELDS, 'source'),
  sort: text(40),
  cursor: first.transform((v) => (typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : 0)),
  // Hosts are ≤ 253 chars; browser names are short.
  host: text(253),
  browser: text(100),
});

export type SourcesParams = {
  tab: SourceTab;
  utm: UtmField;
  sort: string;
  cursor: number;
  /** The drill on this tab: `?host=` (referrers) or `?browser=` (browsers). Null when none. */
  drill: string | null;
};

function withKeys(input: unknown): Record<string, unknown> {
  const s = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    tab: s.tab ?? null,
    utm: s.utm ?? null,
    sort: s.sort ?? null,
    cursor: s.cursor ?? null,
    host: s.host ?? null,
    browser: s.browser ?? null,
  };
}

/** A sort from the allowlist, else `-visitors`. */
export function sourceSort(value: string): string {
  const id = value.startsWith('-') ? value.slice(1) : value;
  return (SOURCE_SORT.allowed as readonly string[]).includes(id) ? value : SOURCE_SORT.default;
}

export const sourcesParamsSchema = z.preprocess(withKeys, rawSchema).transform((raw): SourcesParams => {
  const param = DRILL_PARAM[raw.tab];
  const drill = param === 'host' ? raw.host : param === 'browser' ? raw.browser : '';
  return { tab: raw.tab, utm: raw.utm, sort: sourceSort(raw.sort), cursor: raw.cursor, drill: drill || null };
});

/** Next.js `searchParams` → SourcesParams. */
export function parseSourcesParams(search: Record<string, string | string[] | undefined> | null | undefined): SourcesParams {
  return sourcesParamsSchema.parse(search ?? {});
}
