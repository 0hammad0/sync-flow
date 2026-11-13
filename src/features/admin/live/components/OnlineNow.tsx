'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Skeleton from '@/shared/ui/Skeleton';
import PollingProvider from '../PollingProvider';
import { useMediaQuery } from '../hooks/usePollGate';
import { useOnlineCount } from '../hooks/useLivePoll';

// "N online" (02-overview.md "Online now", 03-layout-and-sidebar.md top bar):
// one `count()` every 60 s while visible, paused after 10 min idle (T-26).
// The top bar polls at ≥ 1024 px; under that it is hidden and the Overview
// badge polls instead. Both read the same cached count.

const DESKTOP = '(min-width: 64rem)';

type Variant = 'topbar' | 'badge';

function Dot({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${on ? 'bg-success' : 'bg-fg-faint'}`} />;
}

function OnlineCount({ variant, enabled, poll }: { variant: Variant; enabled: boolean; poll: boolean }) {
  const { snapshot, mode, resumeIdle } = useOnlineCount({ enabled, poll });
  const count = snapshot.data?.count ?? null;
  const height = variant === 'topbar' ? 'h-8' : 'h-6';

  if (mode === 'idle') {
    return (
      <button
        type="button"
        onClick={resumeIdle}
        className={`inline-flex ${height} items-center gap-2 rounded-md px-2 text-[13px] text-fg-muted pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg`}
      >
        <Dot on={false} />
        Paused, click to resume
      </button>
    );
  }

  if (count === null) {
    // First fetch, or it failed / was refused with nothing to show: keep the space, say nothing.
    if (snapshot.status !== 'ok') return null;
    return <Skeleton className={`${variant === 'topbar' ? 'h-4 w-20' : 'h-4 w-28'}`} />;
  }

  const text = variant === 'topbar' ? `${count.toLocaleString('en-US')} online` : `${count.toLocaleString('en-US')} online now`;
  return (
    <Link
      href="/admin/live"
      className={`inline-flex ${height} items-center gap-2 rounded-md px-2 text-[13px] text-fg pointer-fine:hover:bg-surface-2`}
    >
      <Dot on={count > 0} />
      {/* Polite: the count changes at most once a minute. */}
      <span aria-live="polite" className="tabular-nums">
        {text}
      </span>
      {variant === 'badge' && <ArrowRight aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-fg-muted" />}
    </Link>
  );
}

function TopBarCount() {
  const desktop = useMediaQuery(DESKTOP, false);
  if (!desktop) return null;
  return <OnlineCount variant="topbar" enabled poll />;
}

function BadgeCount() {
  // At ≥ 1024 px the top bar polls; the badge only reads the shared count.
  const desktop = useMediaQuery(DESKTOP, false);
  return <OnlineCount variant="badge" enabled poll={!desktop} />;
}

/** Top-bar "N online" (≥ 1024 px only, polls every 60 s). */
export function OnlineNowDot() {
  return (
    <PollingProvider>
      <TopBarCount />
    </PollingProvider>
  );
}

/** Overview "● N online now →" next to the trend chart. */
export function OnlineNowBadge() {
  return (
    <PollingProvider>
      <BadgeCount />
    </PollingProvider>
  );
}
