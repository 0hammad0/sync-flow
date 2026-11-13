import UsageMeter, { type MeterTone } from '@/shared/ui/UsageMeter';
import type { CheckStatus } from '../cron-status';
import { meterStatus, QUOTA_KINDS, quotaRatio, type QuotaKind, type QuotaUsageDto } from '../tracking-status';
import CronStatusBadge from './CronStatusBadge';

const LABELS: Record<QuotaKind, string> = { writes: 'Writes', reads: 'Reads', deletes: 'Deletes' };
const TONE: Record<CheckStatus, MeterTone> = { ok: 'brand', no_data: 'brand', warn: 'warning', fail: 'danger' };

const count = (n: number) => n.toLocaleString('en-US');

/** Today's admin + tracker Firestore use vs QuotaGuard's caps (14-health.md "Quota meters"). */
export default function QuotaMeters({ usage }: { usage: QuotaUsageDto }) {
  return (
    <section aria-labelledby="quota-title" className="rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="quota-title" className="text-sm font-semibold text-fg">
          Firestore budget today
        </h2>
        <p className="text-xs text-fg-muted">
          {usage.day} UTC · {usage.defaultCaps ? 'default caps' : 'caps from settings'} · updated every few minutes
        </p>
      </div>
      <ul className="mt-3 grid gap-4 sm:grid-cols-3">
        {QUOTA_KINDS.map((kind) => {
          const used = usage.used[kind];
          const cap = usage.caps[kind];
          const status = meterStatus(used, cap);
          const text = `${count(used)} of ${count(cap)}`;
          return (
            <li key={kind} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-fg">{LABELS[kind]}</span>
                <CronStatusBadge status={status} />
              </div>
              <UsageMeter label={`Firestore ${kind} used today`} value={used} max={cap} valueText={text} tone={TONE[status]} />
              <p className="text-xs text-fg-muted tabular-nums">
                {text} · {Math.floor(quotaRatio(used, cap) * 100)}%
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-fg-muted">
        These count admin and tracker only. Chat uses the same Firestore quota: check the total in the Firebase console.
        Free tier: 50,000 reads, 20,000 writes and 20,000 deletes per day.
      </p>
    </section>
  );
}
