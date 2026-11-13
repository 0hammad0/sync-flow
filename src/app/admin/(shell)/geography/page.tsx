import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { CalendarRange } from 'lucide-react';
import { resolveAnalyticsRange, type QueryResult } from '@/features/admin/analytics/queries';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import { parseRangeParams } from '@/features/admin/analytics/range-schema';
import type { BreakdownDto } from '@/features/admin/analytics/types';
import ExportButton from '@/features/admin/export/ExportButton';
import GeoBreadcrumb from '@/features/admin/geography/components/GeoBreadcrumb';
import GeographySkeleton from '@/features/admin/geography/components/GeographySkeleton';
import GeoMap from '@/features/admin/geography/components/GeoMap';
import GeoTable from '@/features/admin/geography/components/GeoTable';
import { geoEmptyCopy } from '@/features/admin/geography/copy';
import { UNKNOWN_REGION, geoHref, type GeoTarget } from '@/features/admin/geography/drill';
import { getGeography } from '@/features/admin/geography/queries';
import { mapDataOf, mapSummaryOf, pageGeoRows, sortGeoRows, toGeoRows } from '@/features/admin/geography/rows';
import { parseGeoParams, type GeoParams } from '@/features/admin/geography/schemas';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import AdminButton from '@/shared/ui/AdminButton';
import Badge from '@/shared/ui/Badge';
import MapEmpty from '@/shared/ui/illustrations/MapEmpty';
import Tooltip from '@/shared/ui/Tooltip';

export const metadata: Metadata = { title: 'Geography' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SAMPLED_TIP = 'Some sessions were skipped to stay in the free Firestore budget; counts were scaled ×2.';

/** URLSearchParams of the request, for links that keep the range (first value of each key). */
function searchOf(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined) params.set(key, v);
  }
  return params;
}

// 07-geography.md. Map + country table, drill country → region → city by URL.
export default async function GeographyPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAdminPage('analytics:read', '/admin/geography');
  const raw = await searchParams;
  const params = parseGeoParams(raw);
  const range = await resolveAnalyticsRange(parseRangeParams(raw));
  const exportButton = <ExportButton table="countries" canExport={can(ctx.role, 'export:csv')} />;

  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-fg">Geography</h1>
        <p className="mt-1 text-sm text-fg-muted">Visitors by place. Location is approximate.</p>
      </header>
      <Suspense fallback={<GeographySkeleton />}>
        <GeographyContent range={range} params={params} search={searchOf(raw).toString()} exportButton={exportButton} />
      </Suspense>
    </>
  );
}

const BUDGET = {
  title: 'Read budget used for today',
  reason: 'Firestore reads for admin pages are paused until 00:00 UTC, so chat keeps working.',
  retry: false,
};

function failure(result: QueryResult<unknown>) {
  if (result.state === 'budget') return BUDGET;
  if (result.state === 'error') {
    return { title: "Couldn't load locations", reason: 'Firestore did not answer.', errorId: result.errorId, retry: true };
  }
  return undefined;
}

async function GeographyContent({
  range,
  params,
  search,
  exportButton,
}: {
  range: ResolvedRange;
  params: GeoParams;
  search: string;
  exportButton: ReactNode;
}) {
  const target: GeoTarget = { country: params.country, region: params.region };
  const { level, countries, list, regions } = await getGeography(range, target);

  const listed: BreakdownDto | null = list.state === 'ok' ? list.data : null;
  const countryDto: BreakdownDto | null = countries.state === 'ok' ? countries.data : null;
  const rows = listed ? sortGeoRows(toGeoRows(listed.rows, level, target), params.sort) : [];
  const page = pageGeoRows(rows, params.cursor);

  // The drilled place's own visitors, from the level above (same docs, no extra reads).
  const parentVisitors = parentVisitorsOf(target, level === 'city' ? regions : countries);
  const copy = geoEmptyCopy({ level, target, rangeDays: range.days, parentVisitors });
  const longer = new URLSearchParams(search);
  longer.delete('from');
  longer.delete('to');
  longer.set('range', '30d');

  // No located visit at all: the table's empty state is the one view, not an empty grey world.
  const showMap = countryDto !== null && countryDto.totalSessions > 0;
  const sampled = Boolean(listed?.meta.sampled || countryDto?.meta.sampled);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <GeoBreadcrumb target={target} />
        {sampled && (
          <Tooltip content={SAMPLED_TIP}>
            <span tabIndex={0} className="rounded-full">
              <Badge>Sampled</Badge>
            </span>
          </Tooltip>
        )}
      </div>

      <div className="order-1 sm:order-2">
        <GeoTable
          level={level}
          target={target}
          rows={page.rows}
          page={{ prevCursor: page.prevCursor, nextCursor: page.nextCursor, total: page.total }}
          error={failure(list)}
          actions={exportButton}
          empty={{
            title: copy.title,
            body: copy.body,
            illustration: copy.illustration === 'map' ? <MapEmpty /> : undefined,
            action: copy.offerLongerRange ? (
              <AdminButton href={geoHref(longer, target)} icon={CalendarRange}>
                Last 30 days
              </AdminButton>
            ) : undefined,
          }}
        />
      </div>

      {showMap && (
        <GeoMap
          data={mapDataOf(countryDto.rows)}
          summary={mapSummaryOf(countryDto.rows, countryDto.totalSessions)}
          total={countryDto.totalSessions}
          className="order-2 sm:order-1"
        />
      )}
    </div>
  );
}

/** Visitors of the drilled country (region level) or region (city level) in the level above. */
function parentVisitorsOf(target: GeoTarget, above: QueryResult<BreakdownDto> | null): number {
  if (!target.country || !above || above.state !== 'ok') return 0;
  const key = target.region ? (target.region === UNKNOWN_REGION ? null : target.region) : target.country;
  return above.data.rows.find((r) => !r.other && r.key === key)?.visitors ?? 0;
}
