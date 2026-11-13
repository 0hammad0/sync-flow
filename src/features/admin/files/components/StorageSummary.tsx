import { AlertTriangle, Info } from 'lucide-react';
import Skeleton from '@/shared/ui/Skeleton';
import UsageMeter from '@/shared/ui/UsageMeter';
import { formatBytes, formatUtc, usageTone } from '../format';
import type { StorageSummaryDto } from '../types';

// R2 usage vs the free tier, the breakdown, and the not-swept note
// (09-files-and-storage.md "Storage totals"). Server component: no JS.

const GB = 1e9;

function gb(bytes: number): string {
  return (bytes / GB).toFixed(2);
}

function Breakdown({ summary, total }: { summary: StorageSummaryDto; total: number | null }) {
  const share = summary.share?.bytes ?? null;
  const chat = summary.chat?.bytes ?? null;
  const other = total !== null && share !== null && chat !== null ? Math.max(0, total - share - chat) : null;
  const parts = [
    { label: 'Share', value: share, hint: summary.share ? `${summary.share.count.toLocaleString('en-US')} files` : null },
    { label: 'Chat', value: chat, hint: summary.chat ? `${summary.chat.objects.toLocaleString('en-US')} files, voice notes included` : null },
    { label: 'Other', value: other, hint: 'Objects with no record yet (uploads in progress or orphans).' },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
      {parts.map((p) => (
        <li key={p.label} title={p.hint ?? undefined}>
          {p.label} <span className="font-medium text-fg tabular-nums">{p.value === null ? '—' : formatBytes(p.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function StorageSummary({ summary, isOwner }: { summary: StorageSummaryDto; isOwner: boolean }) {
  const { bucket, notSwept } = summary;
  const total = bucket.state === 'ok' ? bucket.payloadBytes : null;

  return (
    <section aria-labelledby="storage-title" className="mb-4 flex flex-col gap-3 rounded-lg border border-edge bg-surface p-4">
      <h2 id="storage-title" className="sr-only">
        Storage
      </h2>
      {bucket.state === 'ok' ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-fg">
              <span className="font-semibold">R2</span>{' '}
              <span className="tabular-nums">
                {gb(bucket.payloadBytes)} GB of {bucket.limitBytes / GB} GB free
              </span>
              <span className="text-fg-muted"> · {bucket.objectCount.toLocaleString('en-US')} objects</span>
            </p>
            <p className="text-xs text-fg-muted">Measured {formatUtc(bucket.measuredAt)}</p>
          </div>
          <UsageMeter
            label="R2 storage used"
            value={bucket.payloadBytes}
            max={bucket.limitBytes}
            valueText={`${gb(bucket.payloadBytes)} GB of ${bucket.limitBytes / GB} GB`}
            tone={usageTone(bucket.payloadBytes / bucket.limitBytes)}
          />
        </>
      ) : (
        <p className="flex items-start gap-2 text-sm text-fg-muted">
          <Info aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
          {bucket.state === 'not_configured'
            ? isOwner
              ? 'R2 totals need CF_ACCOUNT_ID and CF_API_TOKEN. Add them in Vercel env.'
              : 'R2 totals are not set up yet.'
            : `Could not load R2 totals. Error id ${bucket.errorId}.`}
        </p>
      )}
      <Breakdown summary={summary} total={total} />
      {notSwept && notSwept.count > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          <AlertTriangle aria-hidden="true" strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
          {notSwept.count.toLocaleString('en-US')} expired {notSwept.count === 1 ? 'file' : 'files'} from signed-in users{' '}
          {notSwept.count === 1 ? 'is' : 'are'} still stored ({formatBytes(notSwept.bytes)}). The cleanup job deletes{' '}
          {notSwept.count === 1 ? 'it' : 'them'} at its next run (03:00 UTC).
        </p>
      )}
    </section>
  );
}

export function StorageSummarySkeleton() {
  return (
    <section aria-busy="true" className="mb-4 flex flex-col gap-3 rounded-lg border border-edge bg-surface p-4">
      <span className="sr-only">Loading storage</span>
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-2 w-full" shape="block" />
      <Skeleton className="h-3 w-2/5" />
    </section>
  );
}
