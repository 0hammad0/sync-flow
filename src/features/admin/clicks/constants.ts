import type { VwBucket } from './types';

// Clicks screen constants (06-clicks.md), zod-free so client components can import them.

export const CLICK_VIEWS = ['list', 'map', 'rage', 'dead'] as const;
export type ClickView = (typeof CLICK_VIEWS)[number];

export const CLICK_VIEW_LABELS: Record<ClickView, string> = { list: 'List', map: 'Map', rage: 'Rage', dead: 'Dead' };

export const VW_BUCKETS: readonly VwBucket[] = ['sm', 'md', 'lg'];

/** Viewport switch labels and the width the map frames the page at. */
export const VW_LABELS: Record<VwBucket, { label: string; width: number; height: number }> = {
  sm: { label: 'Phone', width: 390, height: 844 },
  md: { label: 'Tablet', width: 768, height: 1024 },
  lg: { label: 'Desktop', width: 1280, height: 800 },
};

export const MAP_MODES = ['dots', 'heat'] as const;
export type MapMode = (typeof MAP_MODES)[number];

/**
 * Pages the map may frame (06-clicks.md "Map only for static routes").
 * Narrower than the spec's list on purpose: `/chat` (room listener),
 * `/receive` (creates a send session and polls), `/login` and `/dashboard`
 * (auth redirects, the owner's file list) run app logic or Firestore reads
 * and writes inside the admin, so they are list only.
 */
export const MAP_ALLOWED_PATHS: readonly string[] = ['/', '/send', '/privacy', '/terms'];

export function mapAllowed(path: string | null | undefined): boolean {
  return !!path && MAP_ALLOWED_PATHS.includes(path);
}

/** Rows in the element ranking. */
export const TARGET_LIMIT = 100;
/** Canvas height cap: some browsers refuse canvases taller than 16,384 px. */
export const MAP_MAX_HEIGHT = 16_000;
