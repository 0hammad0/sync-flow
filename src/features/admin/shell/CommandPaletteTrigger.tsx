'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Search } from 'lucide-react';
import Kbd from '@/shared/ui/Kbd';
import { iconButtonClass } from '@/shared/ui/button-styles';
import type { AccessActorDto } from '@/features/admin/access/types';
import type { PaletteActionId } from './command-registry';
import type { NavGroup } from './nav';
import { searchAdmin } from './actions';
import { isTypingTarget } from './sidebar-state';

// The only palette code in the shell bundle (16-command-palette.md
// "Performance"): the top-bar button and the key listener. The palette itself
// is a separate chunk, fetched on first open, or earlier on hover/focus of the
// button or the first ⌘ / Ctrl key press.

const loadPalette = () => import('./CommandPalette');
// searchAdmin is imported here, not in the lazy chunk: a server action that is
// referenced only from a dynamic chunk makes Turbopack split the shared action
// runtime, which added ~0.3 KiB gz to every public page (measured 2026-11-16).
// Here it is one small server reference in the admin shell.

/** Shown for the few ms the chunk takes on first open: the frame and skeleton rows. */
function PaletteLoading() {
  return (
    <div aria-busy="true" className="fixed inset-0 z-50 bg-black/60">
      <div className="mx-auto h-dvh space-y-3 bg-surface p-4 sm:mt-[12vh] sm:h-60 sm:w-[min(560px,92vw)] sm:rounded-xl lg:w-[640px]">
        <span className="sr-only">Loading search</span>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="skeleton block h-6 rounded-md" />
        ))}
      </div>
    </div>
  );
}

const CommandPalette = dynamic(loadPalette, { ssr: false, loading: PaletteLoading });

type CommandPaletteTriggerProps = {
  /** The sidebar's role-filtered nav groups: the palette's Pages. */
  groups: NavGroup[];
  /** Palette actions the role may run (server-filtered). */
  actions: PaletteActionId[];
  canSeeIp: boolean;
  /** For the Block dialog's self-block check. Only sent to roles with `blocks:write`. */
  blockActor: AccessActorDto | null;
};

/** ⌘K on Apple, Ctrl+K elsewhere (either is accepted). Works while typing (10-accessibility.md). */
export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
}

/** Another modal (drawer, dialog) is open: only one modal at a time (edge case 5). */
function otherModalOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"]:not([data-command-palette]), [role="alertdialog"]'));
}

export default function CommandPaletteTrigger({ groups, actions, canSeeIp, blockActor }: CommandPaletteTriggerProps) {
  const [open, setOpen] = useState(false);
  // Mounted on first open and kept, so it can show its follow-up dialogs.
  const [mounted, setMounted] = useState(false);
  const openRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const setPaletteOpen = useCallback((next: boolean) => {
    if (next) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMounted(true);
    }
    openRef.current = next;
    setOpen(next);
  }, []);

  useEffect(() => {
    let preloaded = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!preloaded && (event.key === 'Meta' || event.key === 'Control')) {
        preloaded = true;
        void loadPalette();
      }
      if (isPaletteShortcut(event)) {
        if (event.repeat || (!openRef.current && otherModalOpen())) return;
        event.preventDefault();
        setPaletteOpen(!openRef.current);
        return;
      }
      // `/`: focus the page's search box, or open the palette when there is none.
      // Single-key, so never while typing or with a modal open (WCAG 2.1.4).
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (openRef.current || isTypingTarget(event.target as HTMLElement | null) || otherModalOpen()) return;
      event.preventDefault();
      const search = document.querySelector<HTMLInputElement>('#admin-content input[type="search"]');
      if (search) search.focus();
      else setPaletteOpen(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setPaletteOpen]);

  const preload = () => void loadPalette();

  return (
    <>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        onPointerEnter={preload}
        onFocus={preload}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        aria-label="Search and jump"
        className={iconButtonClass('gap-2 lg:w-auto lg:border lg:border-edge lg:px-2')}
      >
        <Search aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
        <span aria-hidden="true" className="hidden text-[13px] lg:inline">
          Search
        </span>
        <span className="hidden lg:inline-flex">
          <Kbd keys={['mod', 'K']} />
        </span>
      </button>
      {mounted && (
        <CommandPalette
          open={open}
          onOpenChange={setPaletteOpen}
          returnFocusRef={returnFocusRef}
          groups={groups}
          actions={actions}
          canSeeIp={canSeeIp}
          blockActor={blockActor}
          search={searchAdmin}
        />
      )}
    </>
  );
}
