import Link from 'next/link';
import { ArrowRight, Globe } from 'lucide-react';
import { countActiveBlocks } from '@/features/admin/access/queries';
import {
  getOverviewKpis,
  getVisitorTrend,
  listTopCountries,
  listTopPaths,
  listTopReferrers,
  type QueryResult,
} from '@/features/admin/analytics/queries';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import { usageTone } from '@/features/admin/files/format';
import { getStorageSummary } from '@/features/admin/files/queries';
import { getTrackingHealth } from '@/features/admin/health/queries';
import AdminButton from '@/shared/ui/AdminButton';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';
import NoResults from '@/shared/ui/illustrations/NoResults';
import Skeleton from '@/shared/ui/Skeleton';
import UsageMeter from '@/shared/ui/UsageMeter';
import { buildKpiCards, hasVisits, rangeQuery } from '../kpis';
import { KpiRow } from './KpiCard';
import RetryButton from './RetryButton';
import TopList from './TopList';
import TrendChart from './TrendChart';

// One async Server Component per Overview widget. Each sits in its own
// <Suspense> on the page and renders its own budget / error state, so one
// failing read never blanks the rest (06-states.md "Isolation").

const BUDGET_TITLE = "Today's read budget is used up";
const BUDGET_BODY = 'Firestore reads for admin pages are paused until 00:00 UTC, so chat keeps working.';
const ERROR_REASON = 'The server hit an error. It has been logged.';

type Failed = Exclude<QueryResult<unknown>, { state: 'ok' }>;

/** Budget or error, sized for the widget. */
function WidgetState({ result, what, size }: { result: Failed; what: string; size: 'panel' | 'inline' }) {
  if (result.state === 'budget') return <EmptyState size={size} title={BUDGET_TITLE} body={BUDGET_BODY} />;
  return (
    <ErrorState
      size={size}
      illustration={size === 'panel' ? undefined : null}
      title={`Couldn't load ${what}`}
      reason={ERROR_REASON}
      errorId={result.errorId}
      action={<RetryButton />}
    />
  );
}

const SHORT_RANGES = new Set(['today', '24h', '7d']);

// ---------------------------------------------------------------------------

export async function KpiWidget({ range }: { range: ResolvedRange }) {
  const result = await getOverviewKpis(range);
  if (result.state !== 'ok') {
    return (
      <div className="rounded-lg border border-edge bg-surface px-4">
        <WidgetState result={result} what="visitors" size="panel" />
      </div>
    );
  }
  const { current, previous, meta } = result.data;
  if (!hasVisits(current) && !hasVisits(previous)) {
    const offerLonger = SHORT_RANGES.has(range.kind) || (range.kind === 'custom' && range.days < 30);
    return (
      <div className="rounded-lg border border-edge bg-surface px-4">
        <EmptyState
          size="panel"
          illustration={<NoResults />}
          title="No visits in this range"
          body="Pick a longer range. Data shows here a few seconds after someone opens the site."
          action={
            offerLonger ? (
              <AdminButton size="sm" href={`/admin${rangeQuery({ kind: '30d', from: range.from, to: range.to })}`}>
                Last 30 days
              </AdminButton>
            ) : undefined
          }
        />
      </div>
    );
  }
  return (
    <KpiRow cards={buildKpiCards(result.data, range)} sampled={meta.sampled} incomplete={meta.fallbackDays.length > 0} />
  );
}

export async function TrendWidget({ range }: { range: ResolvedRange }) {
  const result = await getVisitorTrend(range);
  if (result.state !== 'ok') return <WidgetState result={result} what="the visitors chart" size="inline" />;
  return <TrendChart trend={result.data} range={range} />;
}

export async function TopPagesWidget({ range }: { range: ResolvedRange }) {
  const result = await listTopPaths(range, 8);
  if (result.state !== 'ok') return <WidgetState result={result} what="top pages" size="inline" />;
  const items = result.data.rows.map((row) => ({
    label: row.label,
    value: row.pageviews,
    href: row.other ? undefined : `/admin/pages${rangeQuery(range, { path: row.path })}`,
  }));
  return (
    <TopList
      items={items}
      total={result.data.totalPageviews}
      sampled={result.data.meta.sampled}
      viewAllHref={`/admin/pages${rangeQuery(range)}`}
    />
  );
}

export async function TopCountriesWidget({ range }: { range: ResolvedRange }) {
  const result = await listTopCountries(range, 8);
  if (result.state !== 'ok') return <WidgetState result={result} what="top countries" size="inline" />;
  const items = result.data.rows.map((row) => ({
    label: row.key && !row.other ? `${row.key} ${row.label}` : row.label,
    value: row.visitors,
    icon: row.key ? undefined : <Globe />,
    href: row.key && !row.other ? `/admin/geography${rangeQuery(range, { country: row.key })}` : undefined,
  }));
  return (
    <TopList
      items={items}
      total={result.data.totalSessions}
      sampled={result.data.meta.sampled}
      viewAllHref={`/admin/geography${rangeQuery(range)}`}
    />
  );
}

export async function TopSourcesWidget({ range }: { range: ResolvedRange }) {
  const result = await listTopReferrers(range, 8);
  if (result.state !== 'ok') return <WidgetState result={result} what="top sources" size="inline" />;
  const items = result.data.rows.map((row) => ({ label: row.key === null ? 'Direct' : row.label, value: row.visitors }));
  return (
    <TopList
      items={items}
      total={result.data.totalSessions}
      sampled={result.data.meta.sampled}
      viewAllHref={`/admin/sources${rangeQuery(range, { tab: 'referrers' })}`}
      emptyBody='Direct visits are counted under "Direct".'
    />
  );
}

/** "Tracking is off" banner (02-overview.md "Tracking off"). Renders nothing when tracking is on or unknown. */
export async function TrackingNotice() {
  const result = await getTrackingHealth();
  if (result.state !== 'ok' || result.enabled) return null;
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface-2 px-4 py-3 text-sm text-fg">
      Tracking is off. New visits are not recorded.
      <Link href="/admin/health" className="text-brand-text underline underline-offset-2">
        See Health
      </Link>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Storage and active blocks (02-overview.md last row). Both cached by their own
// features: R2 totals 10 min, block counts per the Access screen.

const STRIP = 'grid gap-3 sm:grid-cols-2 sm:gap-4';
const TILE = 'flex min-h-24 min-w-0 flex-col justify-between gap-2 rounded-lg border border-edge bg-surface p-4';
const GB = 1e9;

function StorageTile({ bucket }: { bucket: Awaited<ReturnType<typeof getStorageSummary>>['bucket'] }) {
  if (bucket.state !== 'ok') {
    return (
      <div className={TILE}>
        <span className="text-[13px] text-fg-muted">Storage</span>
        <p className="text-sm text-fg-muted">
          {bucket.state === 'not_configured' ? 'R2 usage is not set up.' : "Couldn't load storage use."}
        </p>
      </div>
    );
  }
  const ratio = bucket.limitBytes > 0 ? bucket.payloadBytes / bucket.limitBytes : 0;
  const text = `${(bucket.payloadBytes / GB).toFixed(2)} of ${(bucket.limitBytes / GB).toFixed(0)} GB`;
  return (
    <div className={TILE}>
      <div className="flex items-baseline justify-between gap-2">
        <Link href="/admin/files" className="text-[13px] text-fg-muted underline-offset-2 pointer-fine:hover:underline">
          Storage
        </Link>
        <span className="text-sm text-fg tabular-nums">{text}</span>
      </div>
      <UsageMeter label="R2 storage used" value={bucket.payloadBytes} max={bucket.limitBytes} valueText={text} tone={usageTone(ratio)} />
    </div>
  );
}

export async function StorageAndBlocks({ canSeeFiles, canSeeBlocks }: { canSeeFiles: boolean; canSeeBlocks: boolean }) {
  const [storage, blocks] = await Promise.all([
    canSeeFiles ? getStorageSummary().catch(() => null) : null,
    countActiveBlocks().catch(() => null),
  ]);
  return (
    <section aria-label="Storage and blocks" className={STRIP}>
      {canSeeFiles && (storage ? <StorageTile bucket={storage.bucket} /> : <StorageTile bucket={{ state: 'error', errorId: 'n/a' }} />)}
      <div className={TILE}>
        <span className="text-[13px] text-fg-muted">Active blocks</span>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xl font-semibold text-fg tabular-nums">{blocks ? blocks.count.toLocaleString('en-US') : '—'}</span>
          {canSeeBlocks && (
            <Link
              href="/admin/access"
              className="inline-flex items-center gap-1 text-[13px] text-brand-text underline-offset-2 pointer-fine:hover:underline"
            >
              Access control
              <ArrowRight aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

export function StorageAndBlocksSkeleton({ canSeeFiles }: { canSeeFiles: boolean }) {
  return (
    <div aria-busy="true" className={STRIP}>
      <span className="sr-only">Loading storage and blocks</span>
      {canSeeFiles && (
        <div className={TILE}>
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-2 w-full" />
        </div>
      )}
      <div className={TILE}>
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-6 w-10" shape="block" />
      </div>
    </div>
  );
}
