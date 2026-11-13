'use client';

import { useState } from 'react';
import type { LiveDto } from '@/features/admin/analytics/types';
import { deviceSplit, onlineText } from '../format';

/** The online count is announced when it changes, at most once a minute (03-live.md "Accessibility"). */
const ANNOUNCE_EVERY_MS = 60_000;
/** listActiveSessions cap (`LIVE_LIST_LIMIT`). */
const LIST_CAP = 100;

export default function LiveSummary({ data, updatedAt }: { data: LiveDto; updatedAt: number | null }) {
  const text = onlineText(data.online);
  const [announced, setAnnounced] = useState({ text, at: updatedAt ?? 0 });
  if (updatedAt !== null && text !== announced.text && updatedAt - announced.at >= ANNOUNCE_EVERY_MS) {
    setAnnounced({ text, at: updatedAt });
  }
  const devices = deviceSplit(data.byDevice);

  return (
    <section aria-label="Summary" className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <p className="text-2xl font-semibold text-fg tabular-nums">{text}</p>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announced.text}
      </span>
      {devices && <p className="text-sm text-fg-muted tabular-nums">{devices}</p>}
      {data.topPath && (
        <p className="min-w-0 truncate text-sm text-fg-muted" title={data.topPath}>
          Top: <span className="text-fg">{data.topPath}</span>
        </p>
      )}
      <p className="w-full text-xs text-fg-faint">
        Counts browser tabs, not people.
        {data.listed >= LIST_CAP && ` The list shows the newest ${LIST_CAP}.`}
      </p>
    </section>
  );
}
