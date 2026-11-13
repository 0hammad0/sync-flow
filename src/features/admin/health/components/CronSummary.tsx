import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { CronCheck } from '../cron-status';
import { formatAge, formatUtc } from '../format';
import CronStatusBadge from './CronStatusBadge';

const FIX_TIP = 'Check Vercel → Cron Jobs and that CRON_SECRET is set.';

export type CronSummaryItem = { label: string; value: number | null };

type CronSummaryProps = {
  /** Used for the heading id. */
  job: string;
  title: string;
  check: CronCheck;
  now: number;
  /** Counts from the last run, shown after "Last run". */
  items: CronSummaryItem[];
};

/** Last run of one cron job: status, when, its counts, and a "missed run" warning past 26 h. */
export default function CronSummary({ job, title, check, now, items }: CronSummaryProps) {
  const last = check.last;
  const titleId = `${job}-cron-title`;
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-sm font-semibold text-fg">
          {title}
        </h2>
        <CronStatusBadge status={check.status} />
      </div>
      <p className="mt-1 text-sm text-fg-muted">{check.reason}</p>

      {check.missed && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-md bg-danger/10 p-3 text-sm text-danger-text">
          <TriangleAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
          <span>
            Missed run: the last {job} started {last ? formatAge(now - Date.parse(last.startedAt)) : 'never'}. {FIX_TIP}
          </span>
        </p>
      )}

      {last && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <SummaryItem label="Last run">
            <time dateTime={last.startedAt}>{formatUtc(last.startedAt)}</time>
          </SummaryItem>
          {items.map((item) => (
            <SummaryItem key={item.label} label={item.label}>
              {item.value ?? '—'}
            </SummaryItem>
          ))}
        </dl>
      )}
    </section>
  );
}

/** One label + value pair in a summary card. */
export function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="tabular-nums text-fg">{children}</dd>
    </div>
  );
}
