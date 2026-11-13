import type { CronCheck } from '../cron-status';
import CronSummary from './CronSummary';

/** Last visit-statistics rollup and retention run (04:00 UTC). */
export default function RollupCronSummary({ check, now }: { check: CronCheck; now: number }) {
  const last = check.last;
  return (
    <CronSummary
      job="rollup"
      title="Rollup cron"
      check={check}
      now={now}
      items={[
        { label: 'Sessions rolled up', value: last?.sessionsRolledUp ?? null },
        { label: 'IPs removed', value: last?.ipsNulled ?? null },
        { label: 'Sessions deleted', value: last?.sessionsDeleted ?? null },
      ]}
    />
  );
}
