'use client';

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Menu } from 'lucide-react';

/** Why the rail is open as an overlay. Pinned is CSS (shell.css), not this state. */
export type OpenReason = 'hover' | 'focus' | 'tap';

export const HOVER_OPEN_DELAY_MS = 150;
export const HOVER_CLOSE_DELAY_MS = 300;
const FINE_POINTER = '(hover: hover) and (pointer: fine)';

function hasFocusVisible(root: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!root || !active || !root.contains(active)) return false;
  try {
    return active.matches(':focus-visible');
  } catch {
    return false;
  }
}

type SidebarProps = {
  /** Logo + product name. The name fades in with the labels. */
  brand: ReactNode;
  nav: ReactNode;
  footer: ReactNode;
};

/**
 * The rail / pinned sidebar (≥ 768 px). Hover-intent on fine pointers (150 ms
 * open, 300 ms close, re-enter cancels), keyboard focus opens it, touch opens
 * it with the ☰ at the top. Esc closes an overlay. When pinned, shell.css
 * ignores `data-open`, so this state is harmless there.
 */
export default function Sidebar({ brand, nav, footer }: SidebarProps) {
  const [open, setOpen] = useState<OpenReason | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tapRef = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimers = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  };

  useEffect(() => () => clearTimers(), []);

  // A tap-open overlay closes on Esc wherever focus is.
  useEffect(() => {
    if (open !== 'tap') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setOpen(null);
      tapRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !window.matchMedia(FINE_POINTER).matches) return;
    clearTimeout(closeTimer.current);
    if (open) return;
    openTimer.current = setTimeout(() => setOpen((current) => current ?? 'hover'), HOVER_OPEN_DELAY_MS);
  };

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(openTimer.current);
    if (open !== 'hover') return;
    closeTimer.current = setTimeout(() => {
      // Keyboard focus still inside keeps it open (as a focus-open).
      setOpen((current) => (current === 'hover' ? (hasFocusVisible(rootRef.current) ? 'focus' : null) : current));
    }, HOVER_CLOSE_DELAY_MS);
  };

  const onFocus = (event: FocusEvent) => {
    if (open) return;
    let visible = false;
    try {
      visible = (event.target as HTMLElement).matches(':focus-visible');
    } catch {
      visible = false;
    }
    if (!visible) return;
    clearTimers();
    setOpen('focus');
  };

  const onBlur = (event: FocusEvent) => {
    if (rootRef.current?.contains(event.relatedTarget as Node | null)) return;
    setOpen((current) => (current === 'focus' ? null : current));
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    // Only keys from the sidebar itself, not from a menu portalled out of it.
    if (event.key !== 'Escape' || !open || open === 'tap') return;
    if (!rootRef.current?.contains(event.target as Node)) return;
    clearTimers();
    setOpen(null);
  };

  // A link click in a tap-open overlay closes it (the page changes under it).
  const onClick = (event: MouseEvent) => {
    if (open === 'tap' && (event.target as Element).closest('a[href]')) setOpen(null);
  };

  return (
    <div
      ref={rootRef}
      className="admin-sidebar"
      data-open={open ?? undefined}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {open === 'tap' && (
        <div aria-hidden="true" className="admin-sidebar-backdrop" onClick={() => setOpen(null)} />
      )}
      <div className="admin-sidebar-panel">
        <div className="flex h-[var(--admin-topbar-h)] shrink-0 items-center gap-3 pl-5">
          <button
            ref={tapRef}
            type="button"
            aria-label={open === 'tap' ? 'Close navigation' : 'Open navigation'}
            aria-expanded={open === 'tap'}
            onClick={() => setOpen((current) => (current === 'tap' ? null : 'tap'))}
            className="admin-sb-tap -ml-2 size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted active:bg-surface-3"
          >
            <Menu aria-hidden="true" strokeWidth={1.75} className="size-4" />
          </button>
          {brand}
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{nav}</div>
        <div className="flex shrink-0 flex-col gap-0.5 border-t border-edge px-2 py-2">{footer}</div>
      </div>
    </div>
  );
}
