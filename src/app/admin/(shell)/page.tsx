import type { Metadata } from 'next';
import { Suspense } from 'react';
import { resolveAnalyticsRange } from '@/features/admin/analytics/queries';
import {
  KpiWidget,
  StorageAndBlocks,
  StorageAndBlocksSkeleton,
  TopCountriesWidget,
  TopPagesWidget,
  TopSourcesWidget,
  TrackingNotice,
  TrendWidget,
} from '@/features/admin/overview/components/OverviewWidgets';
import { KpiRowSkeleton } from '@/features/admin/overview/components/KpiCard';
import OnlineNowBadge from '@/features/admin/overview/components/OnlineNowBadge';
import { TopListFrame, TopListSkeleton } from '@/features/admin/overview/components/TopList';
import { parseOverviewParams, type OverviewSearchParams } from '@/features/admin/overview/schemas';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import { LineChartSkeleton } from '@/shared/ui/charts/LineChart';

export const metadata: Metadata = { title: 'Overview' };

type OverviewPageProps = { searchParams: Promise<OverviewSearchParams> };

// Overview (02-overview.md). Range from the URL (`?range=`, default 7d, UTC
// days). One <Suspense> per widget: each streams on its own and shows its own
// budget / error state. All rollup widgets share one cached read set.
// Suspense boundaries are not keyed by range: a range change runs in a
// transition, so the old numbers stay until the new ones arrive.
export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  const ctx = await requireAdminPage('analytics:read', '/admin');
  const range = await resolveAnalyticsRange(parseOverviewParams(await searchParams));
  const canSeeFiles = can(ctx.role, 'files:read');
  const canSeeBlocks = can(ctx.role, 'blocks:read');

  return (
    <>
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-fg">Overview</h1>
        <p className="mt-1 text-sm text-fg-muted">How SyncFlow is used. Days are in UTC.</p>
      </header>

      <div className="flex flex-col gap-6">
        <Suspense fallback={null}>
          <TrackingNotice />
        </Suspense>

        <Suspense fallback={<KpiRowSkeleton />}>
          <KpiWidget range={range} />
        </Suspense>

        <section aria-labelledby="trend-title" className="rounded-lg border border-edge bg-surface p-4">
          <div className="mb-2 flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2 id="trend-title" className="text-sm font-semibold text-fg">
              Visitors over time
            </h2>
            <OnlineNowBadge />
          </div>
          <Suspense fallback={<LineChartSkeleton label="visitors chart" />}>
            <TrendWidget range={range} />
          </Suspense>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TopListFrame id="top-pages-title" title="Top pages">
            <Suspense fallback={<TopListSkeleton label="top pages" />}>
              <TopPagesWidget range={range} />
            </Suspense>
          </TopListFrame>
          <TopListFrame id="top-countries-title" title="Top countries">
            <Suspense fallback={<TopListSkeleton label="top countries" />}>
              <TopCountriesWidget range={range} />
            </Suspense>
          </TopListFrame>
          <TopListFrame id="top-sources-title" title="Top sources">
            <Suspense fallback={<TopListSkeleton label="top sources" />}>
              <TopSourcesWidget range={range} />
            </Suspense>
          </TopListFrame>
        </div>

        <Suspense fallback={<StorageAndBlocksSkeleton canSeeFiles={canSeeFiles} />}>
          <StorageAndBlocks canSeeFiles={canSeeFiles} canSeeBlocks={canSeeBlocks} />
        </Suspense>
      </div>
    </>
  );
}
