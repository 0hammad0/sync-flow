import { X } from 'lucide-react';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import RetryButton from '@/features/admin/pages/components/RetryButton';
import { sampleNote } from '@/features/admin/pages/format';
import AdminButton from '@/shared/ui/AdminButton';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';
import Skeleton from '@/shared/ui/Skeleton';
import BarList from '@/shared/ui/charts/BarList';
import type { SourceTab } from '../constants';
import { getSourceDrill } from '../queries';
import { drillItems, drillSubject, hostFromParam } from '../rows';

export const SOURCE_DRILL_ID = 'source-drill';

type SourceDrillProps = {
  range: ResolvedRange;
  tab: SourceTab;
  drill: string;
  /** Same URL without the drill param. */
  closeHref: string;
};

/**
 * Under the table: top entry pages of one referrer, or the versions of one
 * browser, from the newest 500 sessions in the range (≤ 30 days).
 */
export default async function SourceDrill({ range, tab, drill, closeHref }: SourceDrillProps) {
  const result = await getSourceDrill(range, tab, drill);
  const subject = drillSubject(tab, drill);
  const title =
    tab === 'browsers'
      ? `${subject} versions`
      : hostFromParam(drill) === null
        ? 'Entry pages of direct visits'
        : `Entry pages from ${subject}`;

  return (
    <section id={SOURCE_DRILL_ID} aria-label={title} className="rounded-lg border border-edge bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-sm font-semibold break-words text-fg">{title}</h2>
        <AdminButton href={closeHref} variant="ghost" size="sm" icon={X}>
          Close
        </AdminButton>
      </div>
      {result.state === 'budget' ? (
        <EmptyState
          size="inline"
          title="Read budget used for today"
          body="Firestore reads for admin pages are paused until 00:00 UTC, so chat keeps working."
        />
      ) : result.state === 'error' ? (
        <ErrorState
          size="inline"
          title={tab === 'browsers' ? 'Could not load versions.' : 'Could not load entry pages.'}
          reason="Firestore did not answer."
          errorId={result.errorId}
          action={<RetryButton />}
        />
      ) : (
        <>
          <BarList
            items={drillItems(tab, drill, result.data.rows)}
            max={tab === 'browsers' ? 10 : 5}
            showShare
            total={result.data.matched}
            emptyTitle={tab === 'browsers' ? `No ${subject} sessions in the sample` : 'No sessions from this source in the sample'}
          />
          <p className="mt-3 text-xs text-fg-muted">{sampleNote(result.data)}</p>
        </>
      )}
    </section>
  );
}

export function SourceDrillSkeleton() {
  return (
    <div role="status" aria-label="Loading details" className="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-4">
      <Skeleton className="h-4 w-48" />
      {['w-4/5', 'w-3/5', 'w-1/2', 'w-2/5', 'w-1/4'].map((w) => (
        <Skeleton key={w} className={`h-3.5 ${w}`} />
      ))}
    </div>
  );
}
