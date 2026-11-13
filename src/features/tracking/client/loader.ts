'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Tracker loader (~300 B gz): the only tracking code in the first-load
 * bundle. Mounted once in the root layout; renders nothing. No imports of its
 * own beyond React and Next, so nothing else rides into the first load.
 *
 * Never fetches the tracker on `/admin/**`, with Global Privacy Control or
 * Do Not Track on, after "Reject" (`sf_consent=n`), or while tracking is
 * switched off (`sf_cr=off`). Otherwise it waits for `requestIdleCallback`
 * (fallback `setTimeout` 2 s) and imports the tracker chunk, which does the
 * full consent check (`consent.ts`: region probe, banner) and the events.
 *
 * The footer's "Privacy choices" (`[data-privacy-choices]`) opens the banner
 * through the tracker chunk (which only runs after Accept). With GPC or DNT
 * on, the link just opens the privacy page: nothing is loaded.
 *
 * The checks below must match `gate() === 'stop'` in consent.ts
 * (tests/unit/tracking/loader.test.ts holds them together).
 */

type Tracker = typeof import('./tracker');

let tracker: Tracker | null = null;

export const privacySignal = (): boolean =>
  (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true || navigator.doNotTrack === '1';

export const STOP_COOKIE = /(?:^|;)\s*(?:sf_consent=n|sf_cr=off)\s*(?:;|$)/;

export const isAdminPath = (path: string): boolean => /^\/admin(?:\/|$)/.test(path);

function load(then: (m: Tracker) => void): void {
  if (privacySignal()) return;
  import('./tracker')
    .then((m) => then((tracker = m)))
    .catch(() => {});
}

/** Fetches and starts the tracker unless a stop rule applies. Re-checked on every call. */
export function begin(): void {
  try {
    if (!isAdminPath(location.pathname) && !STOP_COOKIE.test(document.cookie)) load((m) => m.start());
  } catch {
    // Never reaches the page.
  }
}

function onClick(event: MouseEvent): void {
  if (!privacySignal() && (event.target as Element | null)?.closest?.('[data-privacy-choices]')) {
    event.preventDefault();
    load((m) => m.choices());
  }
}

if (typeof document !== 'undefined') document.addEventListener('click', onClick);

export function TrackerLoader(): null {
  const path = usePathname();
  useEffect(() => {
    if (tracker) tracker.nav(path);
    else if (typeof requestIdleCallback === 'function') requestIdleCallback(begin);
    else setTimeout(begin, 2000);
  }, [path]);
  return null;
}
