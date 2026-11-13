import type { TimelinePageDto } from '@/server/analytics/dto';
import Tooltip from '@/shared/ui/Tooltip';
import { durationLabel, formatClock, formatDuration, formatFullUtc, formatOffset, timelineItems } from '../format';

type SessionTimelineProps = {
  pages: readonly TimelinePageDto[];
  startedAt: string | null;
  lastSeenAt: string;
  /** The tracker stopped at 100 page views. */
  pageCapReached: boolean;
};

function Dot({ hollow = false }: { hollow?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute top-1.5 -left-[5px] size-2.5 rounded-full border-2 ${hollow ? 'border-edge-strong bg-surface' : 'border-brand bg-brand'}`}
    />
  );
}

/**
 * One session's page views, oldest first (04-sessions.md "Detail"): time,
 * path, time on page to the second, visible time and scroll depth. An `<ol>`
 * with one `<li>` per page view; the session's last event closes it.
 */
export default function SessionTimeline({ pages, startedAt, lastSeenAt, pageCapReached }: SessionTimelineProps) {
  const items = timelineItems(pages, startedAt);

  if (items.length === 0) {
    return <p className="text-sm text-fg-muted">No page views were recorded for this session.</p>;
  }

  return (
    <div className="flex max-w-[880px] flex-col gap-3">
      {pageCapReached && (
        <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-text">
          This session hit the 100-page limit; later pages were not recorded.
        </p>
      )}
      <ol aria-label="Page views" className="ml-1.5 border-l border-edge">
        {items.map((page, i) => (
          <li key={page.id} className="relative pb-4 pl-5">
            <Dot />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <Tooltip content={formatFullUtc(page.ts)}>
                <time
                  tabIndex={0}
                  dateTime={page.ts ?? undefined}
                  className="w-16 shrink-0 rounded-sm text-[13px] text-fg-muted tabular-nums"
                >
                  {page.ts ? formatClock(page.ts) : 'No time'}
                </time>
              </Tooltip>
              <span className="min-w-0 font-mono text-[13px] break-all text-fg">
                {page.path ?? <span className="font-sans text-fg-faint">Path not recorded</span>}
              </span>
              {i > 0 && page.offsetMs !== null && (
                <span className="text-xs text-fg-faint tabular-nums">{formatOffset(page.offsetMs)}</span>
              )}
            </div>
            <p className="mt-0.5 pl-0 text-xs text-fg-muted tabular-nums min-[400px]:pl-[76px]">
              {page.wallMs !== null && (
                <>
                  <span aria-hidden="true">{formatDuration(page.wallMs)} on page</span>
                  <span className="sr-only">{durationLabel(page.wallMs)} on page</span>
                  <span aria-hidden="true"> · </span>
                </>
              )}
              <span aria-hidden="true">{formatDuration(page.engagedMs)} visible</span>
              <span className="sr-only">{durationLabel(page.engagedMs)} visible</span>
              <span aria-hidden="true"> · </span>
              Scrolled {page.scrollMax}%
            </p>
          </li>
        ))}
        <li className="relative pl-5">
          <Dot hollow />
          <div className="flex flex-wrap items-baseline gap-x-3">
            <Tooltip content={formatFullUtc(lastSeenAt)}>
              <time tabIndex={0} dateTime={lastSeenAt} className="w-16 shrink-0 rounded-sm text-[13px] text-fg-muted tabular-nums">
                {formatClock(lastSeenAt)}
              </time>
            </Tooltip>
            <span className="text-[13px] text-fg-muted">Last event</span>
          </div>
        </li>
      </ol>
    </div>
  );
}
