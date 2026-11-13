'use client';

import { useId, useSyncExternalStore, useTransition } from 'react';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { ChevronDown, ChevronUp } from 'lucide-react';
import AdminButton from '@/shared/ui/AdminButton';
import Skeleton from '@/shared/ui/Skeleton';
import WorldMap, { type MapDatum } from '@/shared/ui/map/WorldMap';
import { parseCountryParam } from '../drill';

export const GEO_VIEWS = ['map', 'table'] as const;

const SM = '(min-width: 40rem)'; // 640 px: tablet and up show the map by default.

function subscribe(onChange: () => void) {
  const mq = window.matchMedia?.(SM);
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

/** True from 640 px. Null on the server and during hydration: CSS decides until then. */
function useTabletUp(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribe,
    () => window.matchMedia?.(SM).matches ?? true,
    () => null,
  );
}

type GeoMapProps = {
  data: MapDatum[];
  summary: string;
  /** All visitors of the country level, "Unknown" included (tooltip share base). */
  total: number;
  className?: string;
};

/**
 * The world map panel. Countries only: regions and cities are tables, and the
 * map keeps the drilled country outlined (09-charts-and-maps.md "Drill-down").
 * Collapsible, state in `?view=` (`map` | `table`). With no `view`, it is open
 * from 640 px and closed on phones, where the table comes first and the map
 * chunk is not fetched until "Show map" (07-geography.md acceptance).
 */
export default function GeoMap({ data, summary, total, className = '' }: GeoMapProps) {
  const bodyId = useId();
  const tabletUp = useTabletUp();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useQueryStates(
    {
      view: parseAsStringLiteral(GEO_VIEWS),
      country: parseAsString,
      region: parseAsString,
      cursor: parseAsString,
    },
    { history: 'push' },
  );

  const measured = tabletUp !== null;
  const open = state.view === 'map' || (state.view === null && tabletUp === true);
  // Before hydration with no `?view=`, both layouts render and CSS picks one.
  const cssDefault = state.view === null && !measured;

  const toggle = (next: boolean) => void setState({ view: next ? 'map' : 'table' }, { shallow: true });
  const select = (country: string) =>
    void setState({ country, region: null, cursor: null }, { shallow: false, startTransition });

  const button = (show: boolean, extra = '') => (
    <AdminButton
      variant="ghost"
      size="sm"
      iconRight={show ? ChevronDown : ChevronUp}
      aria-expanded={!show}
      aria-controls={bodyId}
      onClick={() => toggle(show)}
      className={extra}
    >
      {show ? 'Show map' : 'Hide map'}
    </AdminButton>
  );

  return (
    <section aria-labelledby={`${bodyId}-title`} className={`rounded-lg border border-edge bg-surface ${className}`}>
      <div className="flex min-h-11 items-center justify-between gap-3 py-1 pr-1.5 pl-3">
        <h2 id={`${bodyId}-title`} className="text-sm font-semibold text-fg">
          Visitors by country
        </h2>
        {cssDefault ? (
          <>
            {button(true, 'sm:hidden')}
            {button(false, 'hidden sm:inline-flex')}
          </>
        ) : (
          button(!open)
        )}
      </div>
      <div id={bodyId} className={cssDefault ? 'hidden sm:block' : open ? undefined : 'hidden'}>
        <div className={`border-t border-edge p-3 sm:p-4 ${pending ? 'opacity-60 transition-opacity' : ''}`}>
          {open ? (
            <WorldMap
              data={data}
              summary={summary}
              total={total}
              selected={parseCountryParam(state.country)}
              onSelect={select}
              className="mx-auto max-w-4xl"
            />
          ) : (
            // Holds the map's place until the screen width is known.
            cssDefault && <Skeleton shape="block" className="mx-auto aspect-[2/1] w-full max-w-4xl opacity-50" />
          )}
        </div>
      </div>
    </section>
  );
}
