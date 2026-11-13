'use client';

import { useMemo } from 'react';
import type { LiveSessionDto } from '@/features/admin/analytics/types';
import WorldMap from '@/shared/ui/map/WorldMap';
import { liveMapData, liveMapSummary } from '../format';

const UNIT = ['person online', 'people online'] as const;

/**
 * Where the online visitors are, by country. The map kit has no dot mode yet,
 * so this is the choropleth with online counts. The visitors table next to it
 * carries the same data for keyboard and screen readers. The SVG is a lazy
 * chunk; under 375 px the map is not loaded at all.
 */
export default function LiveMap({ sessions, className = '' }: { sessions: readonly LiveSessionDto[]; className?: string }) {
  const data = useMemo(() => liveMapData(sessions), [sessions]);
  return (
    <section aria-label="Map" className={`min-w-0 rounded-lg border border-edge bg-surface p-4 ${className}`}>
      <WorldMap
        data={data}
        summary={liveMapSummary(data)}
        unit={UNIT}
        emptyTitle="No locations right now"
        emptyBody="Locations come from the visitors online now."
      />
    </section>
  );
}
