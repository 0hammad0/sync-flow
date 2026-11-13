import { Suspense } from 'react';
import type { Metadata } from 'next';
import { resolveAnalyticsRange } from '@/features/admin/analytics/queries';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import { parseRangeParams } from '@/features/admin/analytics/range-schema';
import ExportButton from '@/features/admin/export/ExportButton';
import RangeNotes from '@/features/admin/pages/components/RangeNotes';
import { hrefWith, widenRangeHref, type RawSearch } from '@/features/admin/pages/links';
import DeviceDonut, { DeviceDonutSkeleton } from '@/features/admin/sources/components/DeviceDonut';
import SourceDrill, { SourceDrillSkeleton } from '@/features/admin/sources/components/SourceDrill';
import SourcesTabs from '@/features/admin/sources/components/SourcesTabs';
import SourceTable from '@/features/admin/sources/components/SourceTable';
import { DIM_HEADERS, DONUT_TABS, DRILL_PARAM, dimFor } from '@/features/admin/sources/constants';
import { listSources } from '@/features/admin/sources/queries';
import { hasNoTags } from '@/features/admin/sources/rows';
import { parseSourcesParams, type SourcesParams } from '@/features/admin/sources/schemas';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import TableSkeleton from '@/shared/ui/data-table/TableSkeleton';

export const metadata: Metadata = { title: 'Sources' };

const ROUTE = '/admin/sources';

type SearchParams = Promise<RawSearch>;

// 08-sources.md. One rollup map per tab (shared cached docs with Overview);
// the referrer / browser drill reads the ≤ 500-session sample in its own
// Suspense boundary, so it never holds up the table.
export default async function SourcesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAdminPage('analytics:read', ROUTE);
  const raw = await searchParams;
  const params = parseSourcesParams(raw);
  const range = await resolveAnalyticsRange(parseRangeParams(raw));
  const drillParam = DRILL_PARAM[params.tab];
  const showDonut = DONUT_TABS.includes(params.tab);

  return (
    <>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-fg">Sources</h1>
          <p className="mt-1 text-sm text-fg-muted">How people arrive and what they use. Days are in UTC.</p>
        </div>
        <ExportButton table="sources" canExport={can(ctx.role, 'export:csv')} />
      </header>
      <SourcesTabs>
        <div className="flex flex-col gap-4">
          <Suspense key={`${params.tab}:${params.utm}`} fallback={<SourcesSkeleton params={params} donut={showDonut} />}>
            <SourcesPanel range={range} params={params} widenHref={widenRangeHref(ROUTE, raw, range.days)} />
          </Suspense>
          {drillParam && params.drill && (
            <Suspense key={`${params.tab}:${params.drill}`} fallback={<SourceDrillSkeleton />}>
              <SourceDrill range={range} tab={params.tab} drill={params.drill} closeHref={hrefWith(ROUTE, raw, { [drillParam]: null })} />
            </Suspense>
          )}
        </div>
      </SourcesTabs>
    </>
  );
}

const NOTES: Partial<Record<SourcesParams['tab'], string>> = {
  referrers: '"Direct / none" also counts visits where the other site hid where they came from.',
  devices: 'iPads can show as Desktop: iPadOS reports itself as a Mac.',
};

async function SourcesPanel({ range, params, widenHref }: { range: ResolvedRange; params: SourcesParams; widenHref: string | null }) {
  const result = await listSources(range, params);
  const dim = dimFor(params.tab, params.utm);
  const common = { tab: params.tab, utm: params.utm, dim, openDrill: params.drill, widenHref, longRange: range.days >= 30 };
  const noPage = { prevCursor: null, nextCursor: null };

  if (result.state !== 'ok') {
    const error =
      result.state === 'budget'
        ? { title: 'Read budget used for today.', reason: 'Firestore reads for admin pages are paused until 00:00 UTC, so chat keeps working.' }
        : { title: 'Could not load sources.', reason: 'Firestore did not answer. Try again in a moment.', errorId: result.errorId };
    return <SourceTable {...common} rows={[]} total={0} page={noPage} emptyKind="none" untagged={0} error={error} />;
  }

  const { all, rows, total, totalSessions, prevCursor, nextCursor, meta } = result.data;
  // UTM tab with visits but no tag at all: one "(not set)" row says nothing, show the hint instead.
  const noTags = params.tab === 'utm' && all.length > 0 && hasNoTags(all);
  const table = (
    <SourceTable
      {...common}
      rows={noTags ? [] : rows}
      total={noTags ? 0 : total}
      page={noTags ? noPage : { prevCursor, nextCursor }}
      emptyKind={noTags ? 'no-tags' : 'none'}
      untagged={noTags ? totalSessions : 0}
    />
  );
  const note = all.length > 0 ? NOTES[params.tab] : undefined;

  return (
    <div className="flex flex-col gap-2">
      <RangeNotes meta={meta} />
      {DONUT_TABS.includes(params.tab) && all.length > 0 ? (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
          <DeviceDonut dim={dim} rows={all} />
          <div className="min-w-0">{table}</div>
        </div>
      ) : (
        table
      )}
      {note && <p className="text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

function SourcesSkeleton({ params, donut }: { params: SourcesParams; donut: boolean }) {
  const table = (
    <div className="min-w-0 rounded-lg border border-edge bg-surface">
      <TableSkeleton
        label="Loading sources"
        rows={8}
        columns={[
          { id: 'label', label: DIM_HEADERS[dimFor(params.tab, params.utm)], priority: 1 },
          { id: 'visitors', label: 'Visitors', priority: 1, align: 'right', width: 104 },
          { id: 'pageviews', label: 'Views', priority: 3, align: 'right', width: 96 },
          { id: 'bounceRate', label: 'Bounce', priority: 2, align: 'right', width: 88 },
          { id: 'share', label: 'Share', priority: 1, align: 'right', width: 112 },
        ]}
      />
    </div>
  );
  if (!donut) return table;
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
      <DeviceDonutSkeleton />
      {table}
    </div>
  );
}
