import type { Metadata } from 'next';
import CleanupCronSummary from '@/features/admin/health/components/CleanupCronSummary';
import CronRunsTable from '@/features/admin/health/components/CronRunsTable';
import QuotaBanner from '@/features/admin/health/components/QuotaBanner';
import QuotaMeters from '@/features/admin/health/components/QuotaMeters';
import RollupCronSummary from '@/features/admin/health/components/RollupCronSummary';
import TrackingSummary from '@/features/admin/health/components/TrackingSummary';
import { cronCheck, rollupCheck } from '@/features/admin/health/cron-status';
import {
  getCleanupRuns,
  getQuotaUsage,
  getRollupRuns,
  getTrackingHealth,
  type CronRunsResult,
  type TrackingHealthResult,
} from '@/features/admin/health/queries';
import { quotaBanner } from '@/features/admin/health/tracking-status';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';

export const metadata: Metadata = { title: 'Health' };

const BUDGET_TITLE = 'Read budget used for today';
const BUDGET_BODY = 'Firestore reads for admin pages are paused until 00:00 UTC, so chat keeps working.';

// Health (14-health.md): quota meters and tracking (phase 2), cron runs (phase 1).
// The full checks table and thresholds screen arrive in phase 5.
// Each source fails on its own: one failing read never blanks the rest.
export default async function HealthPage() {
  // 14-health.md: analytics:read [U: confirm]. Same as the nav item.
  await requireAdminPage('analytics:read', '/admin/health');
  const [usage, tracking, cleanup, rollup] = await Promise.all([
    getQuotaUsage(),
    getTrackingHealth(),
    getCleanupRuns(),
    getRollupRuns(),
  ]);
  const banner = quotaBanner(usage);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-fg">Health</h1>
        <p className="mt-1 text-sm text-fg-muted">Jobs, errors and free-tier limits.</p>
      </header>

      <div className="flex flex-col gap-6">
        {banner && <QuotaBanner banner={banner} />}
        <QuotaMeters usage={usage} />
        <TrackingPart result={tracking} usage={usage} />
        <RunsPart result={cleanup} what="cleanup runs">
          {(r) => (
            <>
              <CleanupCronSummary check={cronCheck(r.runs, r.checkedAt)} now={r.checkedAt} />
              <section aria-labelledby="cleanup-runs-title">
                <h2 id="cleanup-runs-title" className="mb-2 text-sm font-semibold text-fg">
                  Recent cleanup runs
                </h2>
                <CronRunsTable runs={r.runs} />
              </section>
            </>
          )}
        </RunsPart>
        <RunsPart result={rollup} what="rollup runs">
          {(r) => <RollupCronSummary check={rollupCheck(r.runs, r.checkedAt)} now={r.checkedAt} />}
        </RunsPart>
      </div>
    </>
  );
}

function TrackingPart({ result, usage }: { result: TrackingHealthResult; usage: Parameters<typeof TrackingSummary>[0]['usage'] }) {
  if (result.state === 'budget') return <EmptyState size="panel" title={BUDGET_TITLE} body={BUDGET_BODY} />;
  if (result.state === 'error') {
    return <ErrorState title="Could not load tracking status." reason="Firestore did not answer." errorId={result.errorId} />;
  }
  return <TrackingSummary enabled={result.enabled} ingest={result.ingest} usage={usage} />;
}

function RunsPart({
  result,
  what,
  children,
}: {
  result: CronRunsResult;
  what: string;
  children: (ok: Extract<CronRunsResult, { state: 'ok' }>) => React.ReactNode;
}) {
  if (result.state === 'budget') return <EmptyState size="panel" title={BUDGET_TITLE} body={BUDGET_BODY} />;
  if (result.state === 'error') {
    return <ErrorState title={`Could not load ${what}.`} reason="Firestore did not answer." errorId={result.errorId} />;
  }
  return <>{children(result)}</>;
}
