'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { X } from 'lucide-react';
import IconButton from '@/shared/ui/IconButton';
import Sheet from '@/shared/ui/Sheet';

// Table + page detail (05-pages.md "Layout"). From 1280 px the panel is a
// non-modal `complementary` region beside the table; below that it is a modal
// Sheet (right, or a bottom sheet on phones). Closing clears `?path`.

const WIDE = '(min-width: 1280px)';
const PHONE = '(max-width: 639.98px)';

/** Media query match; `null` on the server and before hydration. */
function useMedia(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}

/** The table's row link for a path, to return focus there after closing. */
function rowLinkFor(path: string): HTMLAnchorElement | null {
  const links = document.querySelectorAll<HTMLAnchorElement>('a[data-row-link], li a[href*="path="]');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href) continue;
    if (new URL(href, window.location.href).searchParams.get('path') === path) return link;
  }
  return null;
}

type PageDetailLayoutProps = {
  table: ReactNode;
  /** The server-rendered panel body for `path`, or null when no `?path=`. */
  panel: ReactNode;
  path: string | null;
};

export default function PageDetailLayout({ table, panel, path }: PageDetailLayoutProps) {
  const [, startTransition] = useTransition();
  const [urlPath, setUrlPath] = useQueryState('path', parseAsString.withOptions({ shallow: false, history: 'push', startTransition }));
  const wide = useMedia(WIDE);
  const phone = useMedia(PHONE);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Hides at once on close; the server render that follows drops the panel.
  const open = Boolean(path && panel && urlPath === path);

  const close = useCallback(() => {
    const last = path;
    void setUrlPath(null);
    if (last) requestAnimationFrame(() => rowLinkFor(last)?.focus());
  }, [path, setUrlPath]);

  // Beside the table: focus moves to the panel title, Esc closes.
  useEffect(() => {
    if (!open || !wide) return;
    titleRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, wide, close]);

  return (
    <div className={open ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start xl:gap-4' : undefined}>
      <div className="min-w-0">{table}</div>
      {open && (
        <>
          {wide !== false && (
            <aside
              aria-labelledby="page-detail-title"
              className="ui-fade hidden rounded-lg border border-edge bg-surface xl:sticky xl:top-[calc(var(--admin-topbar-h)+16px)] xl:block xl:max-h-[calc(100dvh-var(--admin-topbar-h)-32px)] xl:overflow-y-auto"
            >
              <div className="flex items-start justify-between gap-2 border-b border-edge py-2 pr-2 pl-4">
                <h2
                  id="page-detail-title"
                  ref={titleRef}
                  tabIndex={-1}
                  className="min-w-0 pt-1 font-mono text-[13px] leading-5 font-semibold break-all text-fg focus-visible:outline-none"
                >
                  {path}
                </h2>
                <IconButton icon={X} aria-label="Close page details" onClick={close} />
              </div>
              <div className="p-4">{panel}</div>
            </aside>
          )}
          {wide === false && (
            <Sheet
              open
              onOpenChange={(next) => !next && close()}
              side={phone ? 'bottom' : 'right'}
              width="min(420px, 100vw)"
              title={path ?? 'Page'}
              className={phone ? 'h-[85dvh]' : undefined}
            >
              {panel}
            </Sheet>
          )}
        </>
      )}
    </div>
  );
}
