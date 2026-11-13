import type { QueryResult } from '@/features/admin/analytics/queries';
import { formatDay, type ResolvedRange } from '@/features/admin/analytics/range';
import type { PageFlowDto, PageTrendDto } from '@/features/admin/analytics/types';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';
import Skeleton from '@/shared/ui/Skeleton';
import Sparkline from '@/shared/ui/charts/Sparkline';
import { formatBucketTick } from '@/shared/ui/charts/format';
import { getPageDetail } from '../queries';
import { plural, sampleNote } from '../format';
import PageFlowList from './PageFlowList';
import RetryButton from './RetryButton';

const BUDGET = { title: 'Read budget used for today', body: 'Firestore reads for admin pages are paused until 00:00 UTC, so chat keeps working.' };

type PanelProps = {
  range: ResolvedRange;
  path: string;
  /** False: `?path=` is not a tracked route. No query runs. */
  known: boolean;
  /** Link that opens another path's panel, keeping the other params. */
  hrefFor: (path: string) => string;
};

/** Body of the page detail panel (05-pages.md): views over time, then came from / went to. */
export default async function PageDetailPanel({ range, path, known, hrefFor }: PanelProps) {
  if (!known) {
    return (
      <EmptyState size="inline" title="Unknown page." body="This path is not one of the tracked pages. Pick a row in the table." />
    );
  }
  const { trend, flow } = await getPageDetail(range, path);
  return (
    <div className="flex flex-col gap-6 text-[13px]">
      <TrendPart result={trend} />
      <FlowPart result={flow} hrefFor={hrefFor} />
    </div>
  );
}

function TrendPart({ result }: { result: QueryResult<PageTrendDto> }) {
  if (result.state === 'budget') return <EmptyState size="inline" title={BUDGET.title} body={BUDGET.body} />;
  if (result.state === 'error') {
    return (
      <ErrorState
        size="inline"
        title="Could not load views for this page."
        reason="Firestore did not answer."
        errorId={result.errorId}
        action={<RetryButton />}
      />
    );
  }
  const { points, granularity } = result.data;
  const total = points.reduce((sum, p) => sum + p.pageviews, 0);
  const firstPoint = points[0];
  const lastPoint = points.at(-1);
  const tick = (start: string) =>
    granularity === 'hour' ? formatBucketTick(Date.parse(start), 'hour') : formatDay(start.slice(0, 10), false);
  return (
    <section aria-labelledby="page-trend-title">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id="page-trend-title" className="font-medium text-fg">
          Views per {granularity === 'hour' ? 'hour' : 'day'}
        </h3>
        <p className="text-fg-muted tabular-nums">{plural(total, 'view')}</p>
      </div>
      <div className="h-[120px] rounded-md bg-surface-2 px-2 py-3">
        <Sparkline values={points.map((p) => p.pageviews)} className="h-full!" />
      </div>
      {firstPoint && lastPoint && (
        <p aria-hidden="true" className="mt-1 flex justify-between text-xs text-fg-faint tabular-nums">
          <span>{tick(firstPoint.start)}</span>
          <span>{tick(lastPoint.start)}</span>
        </p>
      )}
      {total === 0 && <p className="mt-2 text-fg-muted">No views of this page in this range.</p>}
    </section>
  );
}

function FlowPart({ result, hrefFor }: { result: QueryResult<PageFlowDto>; hrefFor: (path: string) => string }) {
  if (result.state === 'budget') return <EmptyState size="inline" title={BUDGET.title} body={BUDGET.body} />;
  if (result.state === 'error') {
    return (
      <ErrorState
        size="inline"
        title="Could not load page flow."
        reason="Firestore did not answer."
        errorId={result.errorId}
        action={<RetryButton />}
      />
    );
  }
  const flow = result.data;
  return (
    <div className="flex flex-col gap-5">
      <PageFlowList title="Came from" rows={flow.prev} occurrences={flow.occurrences} hrefFor={hrefFor} />
      <PageFlowList title="Went to" rows={flow.next} occurrences={flow.occurrences} hrefFor={hrefFor} />
      <p className="text-xs text-fg-muted">{sampleNote(flow)}</p>
    </div>
  );
}

/** Same shape as the panel: title bar, 120 px block, 5 bars (05-pages.md "Loading"). */
export function PageDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading page details" className="flex flex-col gap-3">
      <Skeleton className="h-[18px] w-2/5" />
      <Skeleton shape="block" className="h-[120px] w-full" />
      {['w-4/5', 'w-3/5', 'w-1/2', 'w-2/5', 'w-1/4'].map((w) => (
        <Skeleton key={w} className={`h-3.5 ${w}`} />
      ))}
    </div>
  );
}
