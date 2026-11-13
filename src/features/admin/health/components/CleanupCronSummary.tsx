import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { CronCheck } from '../cron-status';
import { formatAge, formatUtc } from '../format';
import CronStatusBadge from './CronStatusBadge';

const FIX_TIP = 'Check Vercel → Cron Jobs and that CRON_SECRET is set.';

/** Last cleanup run: when, status, what it deleted, and a "missed run" warning past 26 h. */
export default function CleanupCronSummary({ check, now }: { check: CronCheck; now: number }) {
  const last = check.last;
  return (
    <section aria-labelledby="cleanup-cron-title" className="rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cleanup-cron-title" className="text-sm font-semibold text-fg">
          Cleanup cron
        </h2>
        <CronStatusBadge status={check.status} />
      </div>
      <p className="mt-1 text-sm text-fg-muted">{check.reason}</p>

      {check.missed && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-md bg-danger/10 p-3 text-sm text-danger-text">
          <TriangleAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
          <span>
            Missed run: the last cleanup started {last ? formatAge(now - Date.parse(last.startedAt)) : 'never'}. {FIX_TIP}
          </span>
        </p>
      )}

      {last && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Item label="Last run">
            <time dateTime={last.startedAt}>{formatUtc(last.startedAt)}</time>
          </Item>
          <Item label="Files deleted">{last.filesDeleted ?? '—'}</Item>
          <Item label="Rooms deleted">{last.roomsDeleted ?? '—'}</Item>
          <Item label="Sessions deleted">{last.sessionsDeleted ?? '—'}</Item>
        </dl>
      )}
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="tabular-nums text-fg">{children}</dd>
    </div>
  );
}
