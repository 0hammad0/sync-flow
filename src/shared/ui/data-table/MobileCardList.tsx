'use client';

import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { flexRender, type Cell, type Row, type RowData } from '@tanstack/react-table';
import Checkbox from '@/shared/ui/Checkbox';
import type { AdminTableFeatures } from './types';

type MobileCardListProps<TData extends RowData> = {
  /** Names the list: "Sessions". */
  label: string;
  rows: Row<AdminTableFeatures, TData>[];
  rowHref?: (row: TData) => string;
  onRowHover?: (href: string) => void;
  /** Bulk-selectable: a checkbox top-left on every card. */
  selectable?: boolean;
  onToggleRow?: (row: Row<AdminTableFeatures, TData>, checked: boolean) => void;
  /** Accessible name of a card's checkbox: "Select 203.0.113.7". */
  rowLabel: (row: TData) => string;
  renderActions?: (row: TData) => ReactNode;
  refreshing?: boolean;
};

type Slot = 'title' | 'subtitle' | 'meta' | 'trailing';

function slots<TData extends RowData>(row: Row<AdminTableFeatures, TData>) {
  const out: Record<Slot, Cell<AdminTableFeatures, TData, unknown>[]> = { title: [], subtitle: [], meta: [], trailing: [] };
  for (const cell of row.getAllCells()) {
    const slot = cell.column.columnDef.meta?.card ?? 'meta';
    if (slot !== 'hidden') out[slot].push(cell);
  }
  return out;
}

const render = <TData extends RowData>(cell: Cell<AdminTableFeatures, TData, unknown>) =>
  flexRender(cell.column.columnDef.cell, cell.getContext());

/**
 * Card list for list screens under a 640 px container (04-responsive.md
 * "Tables on mobile"). A `<ul>` with a heading per card; the whole card is
 * the row link. Fields come from each column's `meta.card` slot.
 */
export default function MobileCardList<TData extends RowData>({
  label,
  rows,
  rowHref,
  onRowHover,
  selectable = false,
  onToggleRow,
  rowLabel,
  renderActions,
  refreshing = false,
}: MobileCardListProps<TData>) {
  return (
    <ul aria-label={label} className={refreshing ? 'opacity-60' : undefined}>
      {rows.map((row) => {
        const { title, subtitle, meta, trailing } = slots(row);
        const href = rowHref?.(row.original);
        const titleContent = title.map((cell) => <Fragment key={cell.id}>{render(cell)}</Fragment>);
        const selected = row.getIsSelected();
        return (
          <li
            key={row.id}
            data-state={selected ? 'selected' : undefined}
            onPointerEnter={href && onRowHover ? () => onRowHover(href) : undefined}
            className="relative flex items-start gap-3 border-b border-edge p-3 text-[13px] data-[state=selected]:bg-surface-3 pointer-fine:hover:bg-surface-2"
          >
            {selectable && (
              <span className="relative z-[1] pt-0.5">
                <Checkbox
                  checked={selected}
                  onCheckedChange={(checked) => onToggleRow?.(row, checked)}
                  aria-label={`Select ${rowLabel(row.original)}`}
                />
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="min-w-0 truncate text-sm font-medium text-fg">
                  {href ? (
                    // Stretched link: the whole card opens the row.
                    <Link href={href} prefetch={false} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus">
                      {titleContent}
                    </Link>
                  ) : (
                    titleContent
                  )}
                </h3>
                {trailing.length > 0 && (
                  <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                    {trailing.map((cell) => (
                      <Fragment key={cell.id}>{render(cell)}</Fragment>
                    ))}
                  </span>
                )}
              </div>
              {subtitle.length > 0 && (
                <p className="truncate text-fg-muted">
                  {subtitle.map((cell) => (
                    <Fragment key={cell.id}>{render(cell)}</Fragment>
                  ))}
                </p>
              )}
              {meta.length > 0 && (
                <p className="text-xs text-fg-muted">
                  {meta.map((cell, i) => (
                    <Fragment key={cell.id}>
                      {i > 0 && <span aria-hidden="true"> · </span>}
                      {render(cell)}
                    </Fragment>
                  ))}
                </p>
              )}
            </div>
            {renderActions && <div className="relative z-[1] -my-1">{renderActions(row.original)}</div>}
          </li>
        );
      })}
    </ul>
  );
}
