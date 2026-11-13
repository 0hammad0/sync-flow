'use client';

import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  PIN_MIN_WIDTH,
  isPinShortcut,
  isTypingTarget,
  nextPin,
  sidebarCookie,
  type SidebarMode,
} from './sidebar-state';

type ShellContextValue = {
  mode: SidebarMode;
  /** Flip pinned ↔ rail from what is on screen now, and save it in the cookie. */
  togglePin: () => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = use(ShellContext);
  if (!value) throw new Error('useShell must be used inside <ShellFrame>');
  return value;
}

type ShellFrameProps = {
  /** From the `sf_admin_sidebar` cookie, read on the server. */
  initialMode: SidebarMode;
  children: ReactNode;
};

/**
 * The shell's root grid. Owns the pin preference (cookie + `data-sidebar`) and
 * the ⌘B / Ctrl+B shortcut. Everything inside is server-rendered children.
 */
export default function ShellFrame({ initialMode, children }: ShellFrameProps) {
  const [mode, setMode] = useState<SidebarMode>(initialMode);

  const togglePin = useCallback(() => {
    const pin = nextPin(mode, window.innerWidth);
    document.cookie = sidebarCookie(pin, window.location.protocol === 'https:');
    setMode(pin);
  }, [mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPinShortcut(event) || event.defaultPrevented) return;
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      // Pinning only exists from 1024 px; below that Ctrl+B stays the browser's.
      if (window.innerWidth < PIN_MIN_WIDTH) return;
      event.preventDefault();
      togglePin();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [togglePin]);

  const value = useMemo(() => ({ mode, togglePin }), [mode, togglePin]);

  return (
    <ShellContext value={value}>
      <div className="admin-shell" data-sidebar={mode} data-fullbleed="">
        {children}
      </div>
    </ShellContext>
  );
}
