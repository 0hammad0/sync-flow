'use client';

import Link from 'next/link';
import { signInHref } from '@/features/admin/shell/account';
import AdminButton from '@/shared/ui/AdminButton';
import { formatClock } from '../format';
import { formatAgoShort, LIVE_POLL_MS, type PollMode, type PollStatus } from '../poll';

type LiveStatusProps = {
  mode: PollMode;
  status: PollStatus;
  /** When the shown data arrived (ms). */
  updatedAt: number | null;
  /** 1 s clock; null until hydrated. */
  now: number | null;
  onResumeIdle: () => void;
  onRetry: () => void;
};

type Tone = 'live' | 'muted' | 'warn';

const DOT: Record<Tone, string> = { live: 'bg-success', muted: 'bg-fg-faint', warn: 'bg-warning' };

function Dot({ tone }: { tone: Tone }) {
  return <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[tone]}`} />;
}

const LINK = 'text-brand-text underline underline-offset-2';
const ROW = 'flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]';

/**
 * Header status of the Live poll (03-live.md "States"): updated time, paused,
 * idle, failing, stopped, budget, signed out, no access. Polls never show a
 * loading state; the data is swapped in place.
 */
export default function LiveStatus({ mode, status, updatedAt, now, onResumeIdle, onRetry }: LiveStatusProps) {
  if (status === 'unauthorized') {
    return (
      <p className={`${ROW} text-fg`}>
        <Dot tone="muted" />
        Your session expired. Sign in again to continue.
        <a href={signInHref('/admin/live')} className={LINK}>
          Sign in
        </a>
      </p>
    );
  }
  if (status === 'forbidden') {
    return (
      <p className={`${ROW} text-fg`}>
        <Dot tone="muted" />
        You no longer have access to this page.
        <Link href="/admin" className={LINK}>
          Overview
        </Link>
      </p>
    );
  }
  if (status === 'budget') {
    return (
      <p className={`${ROW} text-fg-muted`}>
        <Dot tone="muted" />
        Today&apos;s read budget is used up. Live is paused until 00:00 UTC.
      </p>
    );
  }
  if (status === 'stopped') {
    return (
      <div className={`${ROW} text-fg`}>
        <Dot tone="warn" />
        Live updates stopped.
        <AdminButton size="sm" onClick={onRetry}>
          Retry
        </AdminButton>
      </div>
    );
  }
  if (mode === 'idle') {
    return (
      <button
        type="button"
        onClick={onResumeIdle}
        className={`${ROW} rounded-md px-2 text-fg-muted pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg`}
      >
        <Dot tone="muted" />
        Paused, click to resume
      </button>
    );
  }
  if (mode === 'paused') {
    return (
      <p className={`${ROW} text-fg-muted`}>
        <Dot tone="muted" />
        Paused
      </p>
    );
  }
  if (mode === 'offline') {
    return (
      <p className={`${ROW} text-fg-muted`}>
        <Dot tone="muted" />
        Offline. Live updates are paused.
      </p>
    );
  }
  if (status === 'failing') {
    return (
      <p className={`${ROW} text-fg`}>
        <Dot tone="warn" />
        Update failed. Retrying in {LIVE_POLL_MS / 1000} s.
      </p>
    );
  }
  const at = updatedAt === null ? null : new Date(updatedAt).toISOString();
  return (
    <p className={`${ROW} text-fg-muted`}>
      <Dot tone="live" />
      {at && now !== null ? (
        <time dateTime={at} title={`${formatClock(at)} UTC`} className="tabular-nums">
          Updated {formatAgoShort(now - (updatedAt ?? now))}
        </time>
      ) : (
        <span>Live</span>
      )}
    </p>
  );
}
