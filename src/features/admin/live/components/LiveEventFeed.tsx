'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUp } from 'lucide-react';
import type { LiveEventDto } from '@/features/admin/analytics/types';
import AdminButton from '@/shared/ui/AdminButton';
import EmptyState from '@/shared/ui/EmptyState';
import { deviceLabel, formatClock, shortId } from '../format';

// Recent page views (03-live.md "Recent events"): newest first, 20 rows on
// phones, 30 on tablets, 50 from 1024 px. Not a live region (too noisy).
// While the reader has scrolled into the list, new rows wait behind a
// "N new page views" button, so nothing moves under the pointer.

const FADE_IN = 'motion-safe:animate-[opacityIn_var(--dur-2)_var(--ease-enter)]';
const HEAD = 'px-3 text-left text-xs font-medium text-fg-muted';
/** Rows past 20 hidden < 640 px, past 30 hidden < 1024 px (the DTO holds ≤ 50). */
const ROW_LIMITS = 'max-sm:[&>*:nth-child(n+21)]:hidden max-lg:[&>*:nth-child(n+31)]:hidden';

export default function LiveEventFeed({ events }: { events: readonly LiveEventDto[] }) {
  const sectionRef = useRef<HTMLElement>(null);
  const latest = useRef(events);
  const [frozen, setFrozen] = useState<readonly LiveEventDto[] | null>(null);
  const [firstIds] = useState(() => new Set(events.map((e) => e.id)));

  useEffect(() => {
    latest.current = events;
  }, [events]);

  useEffect(() => {
    const onScroll = () => {
      const top = sectionRef.current?.getBoundingClientRect().top ?? 0;
      // Scrolled past the top of the list: hold the rows still.
      setFrozen((prev) => (top < 0 ? (prev ?? latest.current) : null));
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  const shown = frozen ?? events;
  const shownIds = new Set(shown.map((e) => e.id));
  const waiting = frozen ? events.filter((e) => !shownIds.has(e.id)).length : 0;

  const showNew = () => {
    setFrozen(null);
    sectionRef.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <section ref={sectionRef} aria-labelledby="live-events-title" className="@container min-w-0 scroll-mt-[var(--admin-topbar-h)] rounded-lg border border-edge bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h2 id="live-events-title" className="text-sm font-semibold text-fg">
          Recent page views
        </h2>
        {waiting > 0 ? (
          <AdminButton size="sm" icon={ArrowUp} onClick={showNew}>
            {waiting === 1 ? '1 new page view' : `${waiting} new page views`}
          </AdminButton>
        ) : (
          <span className="text-xs text-fg-muted">Last 5 minutes</span>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState size="inline" title="No page views in the last 5 minutes" className="px-4" />
      ) : (
        <>
          <table className="hidden w-full table-fixed border-collapse text-[13px] @[560px]:table">
            <caption className="sr-only">Recent page views, newest first</caption>
            <thead>
              <tr className="h-9 border-y border-edge bg-surface-2">
                <th scope="col" className={`${HEAD} w-24`}>
                  Time (UTC)
                </th>
                <th scope="col" className={HEAD}>
                  Page
                </th>
                <th scope="col" className={`${HEAD} w-20`}>
                  Country
                </th>
                <th scope="col" className={`${HEAD} hidden w-20 @[720px]:table-cell`}>
                  Device
                </th>
                <th scope="col" className={`${HEAD} w-20`}>
                  Session
                </th>
              </tr>
            </thead>
            <tbody className={ROW_LIMITS}>
              {shown.map((e) => (
                <tr key={e.id} className={`h-9 border-b border-edge last:border-b-0 ${firstIds.has(e.id) ? '' : FADE_IN}`}>
                  <td className="px-3 text-fg-muted tabular-nums">{formatClock(e.ts)}</td>
                  <td className="truncate px-3 text-fg" title={e.path}>
                    {e.path}
                  </td>
                  <td className="px-3 text-fg-muted">{e.country ?? 'Unknown'}</td>
                  <td className="hidden px-3 text-fg-muted @[720px]:table-cell">{deviceLabel(e.device)}</td>
                  <td className="px-3">
                    <Link href={`/admin/sessions/${e.sessionId}`} className="font-mono text-xs text-fg-muted underline-offset-2 pointer-fine:hover:underline">
                      {shortId(e.sessionId)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul aria-label="Recent page views" className={`flex flex-col @[560px]:hidden ${ROW_LIMITS}`}>
            {shown.map((e) => (
              <li key={e.id} className={`flex flex-col gap-0.5 border-t border-edge px-4 py-2 text-[13px] ${firstIds.has(e.id) ? '' : FADE_IN}`}>
                <span className="text-fg-muted tabular-nums">{formatClock(e.ts)} UTC</span>
                <span className="flex min-w-0 items-center gap-1 text-fg-muted">
                  <span className="truncate text-fg">{e.path}</span>
                  <span className="shrink-0">
                    · {e.country ?? 'Unknown'} ·{' '}
                    <Link href={`/admin/sessions/${e.sessionId}`} className="font-mono text-xs underline-offset-2 pointer-fine:hover:underline">
                      {shortId(e.sessionId)}
                    </Link>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
