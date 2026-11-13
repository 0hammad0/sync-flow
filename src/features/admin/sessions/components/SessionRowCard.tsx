'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { SessionRowDto } from '@/server/analytics/dto';
import { copyText } from '@/shared/lib/clipboard';
import Badge from '@/shared/ui/Badge';
import Tooltip from '@/shared/ui/Tooltip';
import {
  durationLabel,
  formatDevice,
  formatDuration,
  formatFullUtc,
  formatPlace,
  formatStarted,
} from '../format';

// The cells of one session row. Under a 640 px table container DataTable
// shows each row as a card built from these same cells (`meta.card` slots):
//
//   14:02:31 · 4m 12s · 5 pages          ← Started (title)
//   PK Lahore · Mobile · Safari          ← Place (subtitle)
//   / → /chat/[code] · 39.4.2.17         ← Entry → exit, IP (meta)
//
// `CardOnly` parts fill in what the hidden columns show on a wide table.
// The container query matches the DataTable root (`@container`).

/** Shown in the card layout only. */
export function CardOnly({ children }: { children: ReactNode }) {
  return <span className="@[640px]:hidden">{children}</span>;
}

/** sonner loads lazily (LazyToaster), so import it on use. */
async function toast(title: string) {
  const { toast: t } = await import('sonner');
  t.success(title);
}

export function DurationText({ ms }: { ms: number }) {
  return (
    <>
      <span aria-hidden="true" className="tabular-nums">
        {formatDuration(ms)}
      </span>
      <span className="sr-only">{durationLabel(ms)}</span>
    </>
  );
}

/** `14:02:31` today, `13 Nov 14:02` before. Card: plus duration and pages. */
export function StartedCell({ row, today }: { row: SessionRowDto; today: string }) {
  return (
    <span className="tabular-nums">
      <Tooltip content={formatFullUtc(row.startedAt)}>
        <span>{formatStarted(row.startedAt, today)}</span>
      </Tooltip>
      <CardOnly>
        <span aria-hidden="true"> · </span>
        <DurationText ms={row.durationMs} />
        <span aria-hidden="true"> · </span>
        {row.pageviews === 1 ? '1 page' : `${row.pageviews} pages`}
      </CardOnly>
    </span>
  );
}

/** ISO code + city. Card: plus device and browser. */
export function PlaceCell({ row }: { row: SessionRowDto }) {
  return (
    <>
      {formatPlace(row)}
      <CardOnly>
        <span aria-hidden="true"> · </span>
        {formatDevice(row)}
      </CardOnly>
    </>
  );
}

/**
 * Mono IP. Full only for `ip:read` (the DTO is masked on the server before it
 * reaches this component). A full IP copies on click; a masked one is text.
 */
export function IpCell({ row }: { row: Pick<SessionRowDto, 'ip' | 'ipMasked' | 'ipTruncated'> }) {
  if (!row.ip) return <span className="text-fg-faint">—</span>;
  const truncated = row.ipTruncated && (
    <Badge className="ml-1.5 font-sans">truncated</Badge>
  );
  if (row.ipMasked) {
    return (
      <span className="inline-flex items-center font-mono">
        <span>{row.ip}</span>
        <span className="sr-only"> (last part hidden for your role)</span>
        {truncated}
      </span>
    );
  }
  const ip = row.ip;
  return (
    <span className="inline-flex max-w-full items-center">
      <Tooltip content={ip.includes(':') ? ip : 'Copy IP'}>
        <button
          type="button"
          aria-label={`Copy IP ${ip}`}
          onClick={() => {
            void copyText(ip).then(() => toast('IP copied'));
          }}
          className="relative z-[1] min-w-0 cursor-pointer truncate rounded-sm font-mono focus-visible:outline-offset-1 pointer-fine:hover:underline"
        >
          {ip}
        </button>
      </Tooltip>
      {truncated}
    </span>
  );
}

/** Link to the user when the role may open users; the user id is never an email here. */
export function UserCell({ userId, canOpenUsers }: { userId: string | null; canOpenUsers: boolean }) {
  if (!userId) return <span className="text-fg-faint">Guest</span>;
  if (!canOpenUsers) return <span>Signed in</span>;
  return (
    <Tooltip content={userId}>
      <Link
        href={`/admin/users/${encodeURIComponent(userId)}`}
        prefetch={false}
        aria-label={`User ${userId}`}
        className="relative z-[1] font-mono text-[12.5px] text-brand-text pointer-fine:hover:underline"
      >
        {userId.slice(0, 8)}…
      </Link>
    </Tooltip>
  );
}
