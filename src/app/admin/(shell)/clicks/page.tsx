import { Suspense } from 'react';
import type { Metadata } from 'next';
import { resolveAnalyticsRange } from '@/features/admin/analytics/queries';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import { parseRangeParams } from '@/features/admin/analytics/range-schema';
import ClickFilters from '@/features/admin/clicks/components/ClickFilters';
import ClickMap, { ClickMapSkeleton } from '@/features/admin/clicks/components/ClickMap';
import ElementRanking from '@/features/admin/clicks/components/ElementRanking';
import RageDeadTable from '@/features/admin/clicks/components/RageDeadTable';
import { mapAllowed } from '@/features/admin/clicks/constants';
import {
  listClickPoints,
  listClickTargets,
  listDeadClicks,
  listRageClicks,
  listTrackedPaths,
  type ClickQuery,
} from '@/features/admin/clicks/queries';
import { parseClicksParams, type ClicksParams } from '@/features/admin/clicks/schemas';
import type { ClickSampleMeta, TrackedPathDto } from '@/features/admin/clicks/types';
import { formatNumber } from '@/features/admin/format';
import RetryButton from '@/features/admin/pages/components/RetryButton';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';
import NoDataYet from '@/shared/ui/illustrations/NoDataYet';
import NoResults from '@/shared/ui/illustrations/NoResults';
import TableSkeleton from '@/shared/ui/data-table/TableSkeleton';

export const metadata: Metadata = { title: 'Clicks' };

const ROUTE = '/admin/clicks';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Failed = { state: 'budget' } | { state: 'error'; errorId: string };

// 06-clicks.md. The element ranking renders first (server, no client JS);
// the map is a lazy chunk loaded only for `view=map`. Path options and totals
// come from the cached rollups; targets, dots and the rage / dead lists from
// one cached sample of the newest 500 sessions (≤ 30 days of the range).
export default async function ClicksPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage('analytics:read', ROUTE);
  const raw = await searchParams;
  const params = parseClicksParams(raw);
  const range = await resolveAnalyticsRange(parseRangeParams(raw), 'sessions');
  const paths = await listTrackedPaths(range);
  const rows = paths.state === 'ok' ? paths.data.rows : [];
  const path = params.path ?? rows[0]?.path ?? '/';
  const stats = rows.find((r) => r.path === path) ?? null;
  const view = params.view === 'map' && !mapAllowed(path) ? 'list' : params.view;

  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-fg">Clicks</h1>
        <p className="mt-1 text-sm text-fg-muted">Where people click. Days are in UTC.</p>
      </header>
      <ClickFilters paths={rows} path={path} vw={params.vw} view={view} />
      <p className="mb-3 text-xs text-fg-muted">Clicks from visitors without consent are not recorded.</p>
      {params.view === 'map' && view !== 'map' && (
        <p role="status" className="mb-3 rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-fg-muted">
          This page cannot be shown as a map. Use the list.
        </p>
      )}
      {!params.pathIsKnown ? (
        <EmptyState size="page" illustration={<NoResults />} title="Unknown page." body="Pick a page from the list." />
      ) : paths.state !== 'ok' ? (
        <Failure result={paths} />
      ) : (
        <Suspense key={`${path} ${params.vw} ${view}`} fallback={view === 'map' ? <ClickMapSkeleton /> : <RankingSkeleton />}>
          <ViewPanel range={range} params={{ ...params, view }} query={{ path, vw: params.vw }} stats={stats} />
        </Suspense>
      )}
    </>
  );
}

async function ViewPanel({
  range,
  params,
  query,
  stats,
}: {
  range: ResolvedRange;
  params: ClicksParams;
  query: ClickQuery;
  stats: TrackedPathDto | null;
}) {
  const path = query.path ?? '/';
  if (params.view === 'rage' || params.view === 'dead') {
    const result = await (params.view === 'rage' ? listRageClicks : listDeadClicks)(range, query);
    if (result.state !== 'ok') return <Failure result={result} />;
    const { data, meta } = result.data;
    return (
      <div className="flex flex-col gap-2">
        <SampleNote meta={meta} total={stats?.clicks[params.view] ?? 0} unit={params.view === 'rage' ? 'rage clicks' : 'dead clicks'} />
        {data.length === 0 ? (
          <EmptyState
            size="panel"
            illustration={<NoResults />}
            title={params.view === 'rage' ? `No rage clicks on ${path} at this viewport.` : `No dead clicks on ${path} at this viewport.`}
            body="Try another viewport size."
          />
        ) : (
          <RageDeadTable rows={data} kind={params.view} />
        )}
      </div>
    );
  }

  if (params.view === 'map') {
    const result = await listClickPoints(range, query);
    if (result.state !== 'ok') return <Failure result={result} />;
    const { data, meta } = result.data;
    return (
      <div className="flex flex-col gap-2">
        <SampleNote meta={meta} total={stats?.clicks.total ?? 0} unit="clicks" />
        <ClickMap path={path} vw={query.vw} mode={params.mode} points={data.points} targets={data.targets} />
      </div>
    );
  }

  const result = await listClickTargets(range, query);
  if (result.state !== 'ok') return <Failure result={result} />;
  const { data, meta } = result.data;
  if (data.length === 0) {
    const nothingYet = meta.sampleSessions === 0 || (stats?.clicks.total ?? 0) === 0;
    return nothingYet ? (
      <EmptyState size="page" illustration={<NoDataYet />} title="No clicks recorded yet." body="Clicks on links and buttons appear here." />
    ) : (
      <EmptyState
        size="panel"
        illustration={<NoResults />}
        title={`No clicks on ${path} at this viewport.`}
        body="Try another viewport size."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <SampleNote meta={meta} total={stats?.clicks.total ?? 0} unit="clicks" />
      <ElementRanking rows={data} path={path} vw={query.vw} />
    </div>
  );
}

/** "Based on the latest 500 sessions (1,204 clicks). Total clicks on this page in range: 54,112." */
function SampleNote({ meta, total, unit }: { meta: ClickSampleMeta; total: number; unit: string }) {
  return (
    <p className="text-[13px] text-fg-muted">
      Based on the latest {formatNumber(meta.sampleSessions)} {meta.sampleSessions === 1 ? 'session' : 'sessions'} (
      {formatNumber(meta.sampleClicks)} {meta.sampleClicks === 1 ? 'click' : 'clicks'}
      {meta.truncated ? ', capped' : ''}). Total {unit} on this page in range: {formatNumber(total)}.
    </p>
  );
}

function Failure({ result }: { result: Failed }) {
  return result.state === 'budget' ? (
    <ErrorState
      size="panel"
      title="Read budget used for today."
      reason="Firestore reads for admin pages are paused until 00:00 UTC, so chat keeps working."
    />
  ) : (
    <ErrorState
      size="panel"
      title="Could not load clicks."
      reason="Firestore did not answer. Try again in a moment."
      errorId={result.errorId}
      action={<RetryButton />}
    />
  );
}

function RankingSkeleton() {
  return (
    <div className="rounded-lg border border-edge bg-surface">
      <TableSkeleton
        label="Loading clicks"
        rows={10}
        columns={[
          { id: 'target', label: 'Element', priority: 1 },
          { id: 'clicks', label: 'Clicks', priority: 1, align: 'right', width: 80 },
          { id: 'share', label: 'Of views', priority: 2, align: 'right', width: 96 },
          { id: 'rage', label: 'Rage', priority: 1, align: 'right', width: 80 },
          { id: 'dead', label: 'Dead', priority: 2, align: 'right', width: 80 },
        ]}
      />
    </div>
  );
}
