import { Suspense } from 'react';
import type { Metadata } from 'next';
import { resolveAnalyticsRange } from '@/features/admin/analytics/queries';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import { parseRangeParams } from '@/features/admin/analytics/range-schema';
import ExportButton from '@/features/admin/export/ExportButton';
import PageDetailLayout from '@/features/admin/pages/components/PageDetailLayout';
import PageDetailPanel, { PageDetailSkeleton } from '@/features/admin/pages/components/PageDetailPanel';
import PagesTable from '@/features/admin/pages/components/PagesTable';
import RangeNotes from '@/features/admin/pages/components/RangeNotes';
import { hrefWith, widenRangeHref, type RawSearch } from '@/features/admin/pages/links';
import { listPageStats } from '@/features/admin/pages/queries';
import { parsePagesParams, type PagesParams } from '@/features/admin/pages/schemas';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import TableSkeleton from '@/shared/ui/data-table/TableSkeleton';

export const metadata: Metadata = { title: 'Pages' };

const ROUTE = '/admin/pages';

type SearchParams = Promise<RawSearch>;

// 05-pages.md. The table and the detail panel stream in their own Suspense
// boundaries: the panel's flow query (≤ 500 sessions) never holds up the table.
export default async function PagesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAdminPage('analytics:read', ROUTE);
  const raw = await searchParams;
  const params = parsePagesParams(raw);
  const range = await resolveAnalyticsRange(parseRangeParams(raw));
  const hrefFor = (path: string) => hrefWith(ROUTE, raw, { path });

  return (
    <>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-fg">Pages</h1>
          <p className="mt-1 text-sm text-fg-muted">Views and time per page. Days are in UTC.</p>
        </div>
        <ExportButton table="pages" canExport={can(ctx.role, 'export:csv')} />
      </header>
      <PageDetailLayout
        path={params.path}
        table={
          <Suspense fallback={<PagesSkeleton />}>
            <TablePanel range={range} params={params} widenHref={widenRangeHref(ROUTE, raw, range.days)} />
          </Suspense>
        }
        panel={
          params.path ? (
            <Suspense key={params.path} fallback={<PageDetailSkeleton />}>
              <PageDetailPanel range={range} path={params.path} known={params.pathIsKnown} hrefFor={hrefFor} />
            </Suspense>
          ) : null
        }
      />
    </>
  );
}

async function TablePanel({ range, params, widenHref }: { range: ResolvedRange; params: PagesParams; widenHref: string | null }) {
  const result = await listPageStats(range, { q: params.q, mode: params.mode, sort: params.sort, cursor: params.cursor });
  const common = { mode: params.mode, openPath: params.path, widenHref, longRange: range.days >= 30 };
  if (result.state !== 'ok') {
    const error =
      result.state === 'budget'
        ? { title: 'Read budget used for today.', reason: 'Firestore reads for admin pages are paused until 00:00 UTC, so chat keeps working.' }
        : { title: 'Could not load pages.', reason: 'Firestore did not answer. Try again in a moment.', errorId: result.errorId };
    return (
      <PagesTable {...common} rows={[]} total={0} max={0} base={0} page={{ prevCursor: null, nextCursor: null }} error={error} />
    );
  }
  const { meta, rows, total, max, base, prevCursor, nextCursor } = result.data;
  return (
    <div className="flex flex-col gap-2">
      <RangeNotes meta={meta} />
      <PagesTable {...common} rows={rows} total={total} max={max} base={base} page={{ prevCursor, nextCursor }} />
    </div>
  );
}

function PagesSkeleton() {
  return (
    <div className="rounded-lg border border-edge bg-surface">
      <TableSkeleton
        label="Loading pages"
        rows={10}
        columns={[
          { id: 'path', label: 'Path', priority: 1 },
          { id: 'pageviews', label: 'Views', priority: 1, align: 'right', width: 104 },
          { id: 'visitors', label: 'Visitors', priority: 2, align: 'right', width: 104 },
          { id: 'avgEngagedMs', label: 'Avg time', priority: 2, align: 'right', width: 112 },
          { id: 'bounceRate', label: 'Bounce', priority: 2, align: 'right', width: 96 },
          { id: 'exitRate', label: 'Exit', priority: 3, align: 'right', width: 88 },
          { id: 'avgScroll', label: 'Scroll', priority: 3, align: 'right', width: 88 },
        ]}
      />
    </div>
  );
}
