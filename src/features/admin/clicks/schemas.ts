import { z } from 'zod';
import { ROUTE_PATTERNS } from '@/features/tracking/routes';
import { CLICK_VIEWS, MAP_MODES, VW_BUCKETS, type ClickView, type MapMode } from './constants';
import type { VwBucket } from './types';

// URL params of /admin/clicks (06-clicks.md "URL state"):
// `?path=%2F&vw=lg&view=list&mode=dots&range=7d`. The range keys are read by
// range-schema.ts. Never fails: anything unusable falls back silently
// (`vw` → lg, `view` → list, `mode` → dots).

const first = z.unknown().transform((v): unknown => (Array.isArray(v) ? v[0] : v));
const oneOf = <T extends string>(values: readonly T[], fallback: T) =>
  first.transform((v): T => ((values as readonly unknown[]).includes(v) ? (v as T) : fallback));

export const MAX_PATH_PARAM = 200;

const rawSchema = z.object({
  path: first.transform((v) => (typeof v === 'string' ? v.trim().slice(0, MAX_PATH_PARAM) : '')),
  vw: oneOf<VwBucket>(VW_BUCKETS, 'lg'),
  view: oneOf<ClickView>(CLICK_VIEWS, 'list'),
  mode: oneOf<MapMode>(MAP_MODES, 'dots'),
});

export type ClicksParams = {
  /** `?path=` as given; null when absent (the screen then picks the busiest path). */
  path: string | null;
  /** False for a path that is not a tracked pattern ("Unknown page.", no query). */
  pathIsKnown: boolean;
  vw: VwBucket;
  view: ClickView;
  mode: MapMode;
};

function withKeys(input: unknown): Record<string, unknown> {
  const s = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return { path: s.path ?? null, vw: s.vw ?? null, view: s.view ?? null, mode: s.mode ?? null };
}

export const clicksParamsSchema = z.preprocess(withKeys, rawSchema).transform(
  (raw): ClicksParams => ({
    path: raw.path || null,
    pathIsKnown: !raw.path || (ROUTE_PATTERNS as readonly string[]).includes(raw.path),
    vw: raw.vw,
    view: raw.view,
    mode: raw.mode,
  }),
);

export function parseClicksParams(search: Record<string, string | string[] | undefined> | null | undefined): ClicksParams {
  return clicksParamsSchema.parse(search ?? {});
}
