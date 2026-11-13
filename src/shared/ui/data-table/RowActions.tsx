'use client';

import { MoreHorizontal } from 'lucide-react';
import DropdownMenu, { type MenuItem } from '@/shared/ui/DropdownMenu';
import { ICON_BUTTON } from './styles';

export type RowAction = Extract<MenuItem, { type: 'item' }>;

type RowActionsProps = {
  /** Names the row: "Actions for 203.0.113.7". */
  label: string;
  /** Only items the role may use. `…` in a label means a dialog follows. */
  items: RowAction[];
  className?: string;
};

/** Safe items first; destructive ones last, after a separator (08-tables.md "Row actions"). */
export function orderRowActions(items: RowAction[]): MenuItem[] {
  const safe = items.filter((item) => item.tone !== 'danger');
  const danger = items.filter((item) => item.tone === 'danger');
  if (!safe.length || !danger.length) return [...safe, ...danger];
  return [...safe, { type: 'separator', id: 'danger' }, ...danger];
}

/**
 * The `⋯` menu in a row's last cell. Always visible on touch; on a fine
 * pointer it shows on row hover AND when anything in the row has focus,
 * so it is never hover-only. Renders nothing when no item is allowed.
 */
export default function RowActions({ label, items, className = '' }: RowActionsProps) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu
      align="end"
      items={orderRowActions(items)}
      trigger={
        <button
          type="button"
          aria-label={label}
          className={`${ICON_BUTTON} pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-fine:data-[state=open]:opacity-100 ${className}`}
        >
          <MoreHorizontal aria-hidden="true" strokeWidth={1.75} className="size-4" />
        </button>
      }
    />
  );
}
