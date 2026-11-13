'use client';

import { useSyncExternalStore } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Kbd from '@/shared/ui/Kbd';
import { useShell } from './ShellFrame';
import { AUTO_PIN_MIN_WIDTH, PIN_MIN_WIDTH, effectivePin } from './sidebar-state';
import { SIDEBAR_ROW } from './styles';

const QUERIES = [`(min-width: ${PIN_MIN_WIDTH}px)`, `(min-width: ${AUTO_PIN_MIN_WIDTH}px)`];

function subscribe(onChange: () => void) {
  const lists = QUERIES.map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener('change', onChange));
  return () => lists.forEach((l) => l.removeEventListener('change', onChange));
}
// A width that lands in the same band as the viewport: enough for effectivePin.
const getWidth = () =>
  window.matchMedia(QUERIES[1]).matches ? AUTO_PIN_MIN_WIDTH : window.matchMedia(QUERIES[0]).matches ? PIN_MIN_WIDTH : 0;
const getServerWidth = () => PIN_MIN_WIDTH;

/**
 * Pin / unpin (≥ 1024 px only; below that the sidebar is a rail or drawer).
 * The icon and visible label come from CSS (`--sb-pinned`), so they are right
 * on first paint; the accessible name and aria-expanded follow after hydration.
 */
export default function PinToggle() {
  const { mode, togglePin } = useShell();
  const pinned = effectivePin(mode, useSyncExternalStore(subscribe, getWidth, getServerWidth)) === 'pinned';

  return (
    <button
      type="button"
      onClick={togglePin}
      aria-expanded={pinned}
      aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
      aria-keyshortcuts="Meta+B Control+B"
      className={`${SIDEBAR_ROW} hidden lg:flex`}
    >
      <span aria-hidden="true" className="relative size-4 shrink-0">
        <PanelLeftClose strokeWidth={1.75} className="admin-pin-icon-pinned absolute inset-0 size-4" />
        <PanelLeftOpen strokeWidth={1.75} className="admin-pin-icon-rail absolute inset-0 size-4" />
      </span>
      <span aria-hidden="true" className="admin-sb-label flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="grid min-w-0 text-left">
          <span className="admin-pin-icon-pinned col-start-1 row-start-1 truncate">Unpin sidebar</span>
          <span className="admin-pin-icon-rail col-start-1 row-start-1 truncate">Pin sidebar</span>
        </span>
        <Kbd keys={['mod', 'B']} />
      </span>
    </button>
  );
}
