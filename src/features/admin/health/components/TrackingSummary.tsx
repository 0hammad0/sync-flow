import Badge from '@/shared/ui/Badge';
import { ingestCheck, samplingStatus, type IngestCounts, type QuotaUsageDto } from '../tracking-status';
import CronStatusBadge from './CronStatusBadge';
import { SummaryItem as Item } from './CronSummary';

const count = (n: number) => n.toLocaleString('en-US');

/** Visit statistics: kill switch, ingest health over the last 24 h, and sampling today. */
export default function TrackingSummary({
  enabled,
  ingest,
  usage,
}: {
  enabled: boolean;
  ingest: IngestCounts;
  usage: QuotaUsageDto;
}) {
  const check = ingestCheck(enabled, ingest);
  const sampling = samplingStatus(usage);
  return (
    <section aria-labelledby="tracking-title" className="rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tracking-title" className="flex items-center gap-2 text-sm font-semibold text-fg">
          Visit tracking
          <Badge tone={enabled ? 'brand' : 'neutral'} dot>
            {enabled ? 'On' : 'Off'}
          </Badge>
        </h2>
        {enabled && <CronStatusBadge status={check.status} />}
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {enabled ? check.reason : 'Tracking is off. No visit data is collected. Turn it on in admin_config/settings.'}
      </p>

      {enabled && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
          <Item label="Events, 24 h">{count(check.total)}</Item>
          <Item label="Saved">{count(ingest.accepted)}</Item>
          <Item label="Sampled out">{count(ingest.sampledOut)}</Item>
          <Item label="Dropped">{count(ingest.dropped)}</Item>
          <Item label="Failed">{`${count(ingest.error)} (${(check.errorRate * 100).toFixed(1)}%)`}</Item>
        </dl>
      )}
      <p className="mt-3 text-xs text-fg-muted">Sampling: {sampling.reason}</p>
    </section>
  );
}
