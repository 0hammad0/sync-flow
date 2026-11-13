import type { CronCheck } from '../cron-status';
import CronSummary from './CronSummary';

/** Last cleanup run (03:00 UTC). */
export default function CleanupCronSummary({ check, now }: { check: CronCheck; now: number }) {
  const last = check.last;
  return (
    <CronSummary
      job="cleanup"
      title="Cleanup cron"
      check={check}
      now={now}
      items={[
        { label: 'Files deleted', value: last?.filesDeleted ?? null },
        { label: 'Rooms deleted', value: last?.roomsDeleted ?? null },
        { label: 'Sessions deleted', value: last?.sessionsDeleted ?? null },
      ]}
    />
  );
}
