'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ListFilter, Search, X } from 'lucide-react';
import Input from '@/shared/ui/Input';
import Sheet from '@/shared/ui/Sheet';
import { formatCount, GHOST_BUTTON, SECONDARY_BUTTON } from './styles';

type ToolbarProps = {
  /** Omit for tables without search. */
  search?: {
    value: string;
    onChange: (value: string) => void;
    /** Names what is searchable: "Search IP, path or id". */
    placeholder: string;
  };
  /** Filter chips and the `[+ Filter]` menu. Inline from a 640 px container; in a bottom Sheet below it. */
  filters?: ReactNode;
  activeFilters?: number;
  /** Clears the table's own filters. The search is cleared by the toolbar. */
  onClearFilters?: () => void;
  /** Number shown on the Sheet's close button: "Show 214 results". */
  resultCount?: number | null;
  /** The ColumnMenu. Hidden under 640 px (cards have no columns). */
  columnMenu?: ReactNode;
  /** Right side, e.g. `[Export CSV]` (only with `export:csv`). */
  actions?: ReactNode;
};

/** True when the key press should not trigger a single-key shortcut (10-accessibility.md). */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Search, filters, columns and page actions above a table. Search updates
 * the URL after a 250 ms pause (the input itself never waits), Esc clears
 * it, and `/` focuses it from anywhere on the page.
 */
export default function Toolbar({
  search,
  filters,
  activeFilters = 0,
  onClearFilters,
  resultCount,
  columnMenu,
  actions,
}: ToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const hasSearch = Boolean(search);

  useEffect(() => {
    if (!hasSearch) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hasSearch]);

  const canClear = activeFilters > 0 || Boolean(search?.value);
  const clearAll = () => {
    onClearFilters?.();
    search?.onChange('');
  };

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
      {search && (
        <Input
          ref={searchRef}
          type="search"
          label={search.placeholder}
          hideLabel
          placeholder={search.placeholder}
          leading={Search}
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && search.value) {
              event.preventDefault();
              search.onChange('');
            }
          }}
          className="w-full @[640px]:w-72"
        />
      )}

      {filters && (
        <>
          <div className="hidden flex-wrap items-center gap-2 @[640px]:flex">{filters}</div>
          <button type="button" onClick={() => setSheetOpen(true)} className={`${SECONDARY_BUTTON} @[640px]:hidden`}>
            <ListFilter aria-hidden="true" strokeWidth={1.75} className="size-4" />
            {activeFilters > 0 ? `Filters (${activeFilters})` : 'Filters'}
          </button>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen} side="bottom" title="Filters">
            <div className="flex flex-col gap-3">
              {filters}
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className={`${SECONDARY_BUTTON} w-full justify-center`}
              >
                {resultCount == null ? 'Show results' : `Show ${formatCount(resultCount)} results`}
              </button>
            </div>
          </Sheet>
        </>
      )}

      {canClear && (
        <button type="button" onClick={clearAll} className={GHOST_BUTTON}>
          <X aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          Clear filters
        </button>
      )}

      {(columnMenu || actions) && (
        <div className="ml-auto flex items-center gap-1">
          {columnMenu && <div className="hidden @[640px]:contents">{columnMenu}</div>}
          {actions}
        </div>
      )}
    </div>
  );
}
