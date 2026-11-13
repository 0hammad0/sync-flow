'use client';

import dynamic from 'next/dynamic';
import { useMemo, useSyncExternalStore } from 'react';
import EmptyState from '../EmptyState';
import MapEmpty from '../illustrations/MapEmpty';
import Skeleton from '../Skeleton';
import { ChunkBoundary, useRetryableChunk } from '../charts/lazy-chunk';
import { alpha2ToNumeric } from './iso-codes';
import { buildScale, legendItems } from './scale';

export type MapDatum = {
  /** ISO 3166-1 alpha-2, e.g. `PK`. Unknown codes are left off the map (the table still counts them). */
  country: string;
  value: number;
};

export type WorldMapProps = {
  data: MapDatum[];
  /** Screen-reader sentence, built on the server: "Top countries: Pakistan 23%, United States 18%, India 9%". */
  summary: string;
  /** Share base for the tooltip. Default: the sum of `data` (pass the full total when it includes "Unknown"). */
  total?: number;
  /** Default `['visitor', 'visitors']`. */
  unit?: readonly [singular: string, plural: string];
  /** Alpha-2 of the selected country: drawn with a 1.5 px `--fg` outline. */
  selected?: string | null;
  /** Click or tap on a country with data. The keyboard path is the countries table next to the map. */
  onSelect?: (country: string) => void;
  /** Default "No locations yet". */
  emptyTitle?: string;
  /** Default "Locations come from visits. None in this range." */
  emptyBody?: string;
  className?: string;
};

const SMALL_SCREEN = '(min-width: 23.4375rem)'; // --breakpoint-xs, 375 px
const DEFAULT_UNIT = ['visitor', 'visitors'] as const;

const createMap = () =>
  dynamic(() => import('./WorldMapSvg'), { ssr: false, loading: () => <MapSkeleton /> });
const FirstMap = createMap();

const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(SMALL_SCREEN) : null);

function subscribe(onChange: () => void) {
  const mq = query();
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

/** True at 375 px and up. Server and first paint assume true, so the skeleton holds the space. */
function useWideEnough(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? true,
    () => true
  );
}

/**
 * Choropleth of visitors by country: own SVG (d3-geo Equal Earth, world-atlas
 * 110m, no Antarctica), quantile buckets on `--seq-1 … --seq-6`, zero in
 * `--surface-2`, legend with ranges under it. The map is a lazy chunk with a
 * 2:1 skeleton; under 375 px it is not loaded at all and a line says so.
 * It is never the only view: the screen puts the countries table next to it,
 * and that table is the keyboard and screen-reader path (the map is a
 * `role="img"` figure labelled with `summary`).
 */
export default function WorldMap({
  data,
  summary,
  total,
  unit = DEFAULT_UNIT,
  selected,
  onSelect,
  emptyTitle = 'No locations yet',
  emptyBody = 'Locations come from visits. None in this range.',
  className = '',
}: WorldMapProps) {
  const wide = useWideEnough();
  const [MapSvg, retry] = useRetryableChunk(FirstMap, createMap);

  const values = useMemo(() => {
    const merged = new Map<string, number>();
    for (const { country, value } of data) {
      const code = country.toUpperCase();
      if (!alpha2ToNumeric(code) && code !== 'XK') continue;
      merged.set(code, (merged.get(code) ?? 0) + value);
    }
    return merged;
  }, [data]);
  const scale = useMemo(() => buildScale([...values.values()]), [values]);
  const shareBase = total ?? data.reduce((s, d) => s + Math.max(0, d.value), 0);

  if (!scale) {
    return (
      <div className={`flex min-h-64 items-center ${className}`}>
        <EmptyState size="panel" illustration={<MapEmpty />} title={emptyTitle} body={emptyBody} />
      </div>
    );
  }

  if (!wide) {
    return <p className={`text-xs text-fg-muted ${className}`}>Map hidden on small screens.</p>;
  }

  return (
    <div className={className}>
      <ChunkBoundary title="Couldn't load the map." onRetry={retry}>
        <MapSvg
          values={values}
          scale={scale}
          total={shareBase}
          unit={unit}
          summary={summary}
          selected={selected?.toUpperCase() ?? null}
          onSelect={onSelect}
        />
      </ChunkBoundary>
      <ul aria-label="Visitors per country" className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted tabular-nums">
        <li className="inline-flex items-center gap-1.5">
          <Swatch color="var(--surface-2)" />0
        </li>
        {legendItems(scale).map((item) => (
          <li key={item.label} className="inline-flex items-center gap-1.5">
            <Swatch color={item.color} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm border border-edge" style={{ background: color }} />
  );
}

/** Loading state for the map: a 2:1 block, the size of the loaded map. */
export function MapSkeleton() {
  return (
    <div aria-busy="true" className="relative aspect-[2/1] w-full">
      <span className="sr-only">Loading map</span>
      <Skeleton shape="block" className="absolute inset-0 opacity-50" />
    </div>
  );
}
