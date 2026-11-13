// Class strings shared by the data-table parts. Admin Button/IconButton
// variants (05-components.md) are not in the kit yet; these match them.

/** Square ghost icon button: 32 px, 40 px on touch. */
export const ICON_BUTTON =
  'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors duration-[var(--dur-1)] pointer-coarse:size-10 pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg data-[state=open]:bg-surface-2 data-[state=open]:text-fg';

/** Ghost text button, 28 px. */
export const GHOST_BUTTON =
  'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] text-fg-muted transition-colors duration-[var(--dur-1)] pointer-coarse:h-10 pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg';

/** Secondary text button, 28 px. */
export const SECONDARY_BUTTON =
  'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-edge-strong bg-surface px-2.5 text-[13px] text-fg transition-colors duration-[var(--dur-1)] pointer-coarse:h-10 pointer-fine:hover:bg-surface-2';

/** Columns by priority: P2 from a 640 px table container, P3 from 960 px. */
export const PRIORITY_CELL = {
  1: '',
  2: 'hidden @[640px]:table-cell',
  3: 'hidden @[960px]:table-cell',
} as const;

/** `en-US` grouping: 1,204. */
export const formatCount = (n: number) => n.toLocaleString('en-US');
