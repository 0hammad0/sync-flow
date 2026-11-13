'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { BULK_CAP } from './types';
import { formatCount, GHOST_BUTTON, ICON_BUTTON } from './styles';

type BulkBarProps = {
  /** Rows ticked on this page. */
  count: number;
  /** All rows matching the current filters. Omit when unknown: no "Select all matching". */
  totalMatching?: number | null;
  /** "Select all matching" is on: the server re-applies the filters. */
  allMatching: boolean;
  onSelectAllMatching: () => void;
  onClear: () => void;
  /** Delete, Block, Export selected. Destructive ones open a ConfirmDialog. */
  children?: ReactNode;
};

/**
 * Replaces the toolbar while at least one row is selected, at the same
 * height so nothing shifts. On phones it is fixed to the bottom edge.
 */
export default function BulkBar({ count, totalMatching, allMatching, onSelectAllMatching, onClear, children }: BulkBarProps) {
  const total = totalMatching ?? null;
  const canSelectAll = total !== null && !allMatching && total > count;
  const overCap = allMatching && total !== null && total > BULK_CAP;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge bg-surface px-3 py-1.5 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:border-t max-sm:border-b-0 max-sm:pb-[calc(0.375rem+env(safe-area-inset-bottom))] max-sm:shadow-[var(--shadow-float)]"
    >
      <p aria-live="polite" className="text-[13px] font-medium text-fg tabular-nums">
        {allMatching && total !== null ? `All ${formatCount(total)} matching selected` : `${formatCount(count)} selected`}
      </p>
      {canSelectAll && (
        <button type="button" onClick={onSelectAllMatching} className={`${GHOST_BUTTON} text-brand-text`}>
          Select all {formatCount(total)} matching
        </button>
      )}
      {overCap && <p className="text-xs text-fg-muted">Up to {formatCount(BULK_CAP)} at a time</p>}
      <div className="ml-auto flex items-center gap-2">
        {children}
        <button type="button" aria-label="Clear selection" onClick={onClear} className={ICON_BUTTON}>
          <X aria-hidden="true" strokeWidth={1.75} className="size-4" />
        </button>
      </div>
    </div>
  );
}
