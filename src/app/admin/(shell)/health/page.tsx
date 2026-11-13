import type { Metadata } from 'next';
import CleanupCronSummary from '@/features/admin/health/components/CleanupCronSummary';
import CronRunsTable from '@/features/admin/health/components/CronRunsTable';
import { cronCheck } from '@/features/admin/health/cron-status';
import { getCleanupRuns } from '@/features/admin/health/queries';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';

export const metadata: Metadata = { title: 'Health' };

// Health v1 (phase 1 step 1.7): cleanup cron runs only. Quota meters and the
// other checks arrive in phases 2 and 5 (docs/admin/03-features/14-health.md).
export default async function HealthPage() {
  // 14-health.md: analytics:read [U: confirm]. Same as the nav item.
  await requireAdminPage('analytics:read', '/admin/health');
  const result = await getCleanupRuns();

  return (
    <>
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-fg">Health</h1>
        <p className="mt-1 text-sm text-fg-muted">Jobs, errors and free-tier limits.</p>
      </header>

      {result.state === 'budget' && (
        <EmptyState
          size="panel"
          title="Read budget used for today"
          body="Firestore reads for admin pages are paused until 00:00 UTC, so chat keeps working."
        />
      )}
      {result.state === 'error' && (
        <ErrorState title="Could not load cron runs." reason="Firestore did not answer." errorId={result.errorId} />
      )}
      {result.state === 'ok' && (
        <div className="flex flex-col gap-6">
          <CleanupCronSummary check={cronCheck(result.runs, result.checkedAt)} now={result.checkedAt} />
          <section aria-labelledby="cleanup-runs-title">
            <h2 id="cleanup-runs-title" className="mb-2 text-sm font-semibold text-fg">
              Recent cleanup runs
            </h2>
            <CronRunsTable runs={result.runs} />
          </section>
        </div>
      )}
    </>
  );
}
