// Class strings shared by server and client parts of the shell. Plain module:
// importing it from a client component pulls in nothing else.

/** Shared row look for nav links and footer buttons. 36 px (40 on touch); icon at x = 24 in the rail. */
export const SIDEBAR_ROW =
  'admin-nav-item relative flex h-9 shrink-0 cursor-pointer items-center gap-3 overflow-hidden rounded-md pr-2 pl-4 text-sm text-fg-muted transition-colors duration-[var(--dur-1)] pointer-coarse:h-10 pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg active:bg-surface-3';

/** Secondary admin button (05-components.md): 32 px, 40 on touch. */
export const BUTTON_SECONDARY =
  'inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md border border-edge-strong bg-surface px-3 text-sm font-medium text-fg transition-colors duration-[var(--dur-1)] pointer-coarse:h-10 pointer-fine:hover:bg-surface-2 active:bg-surface-3';

/** Square ghost icon button. */
export const ICON_BUTTON =
  'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors duration-[var(--dur-1)] pointer-coarse:size-10 pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg active:bg-surface-3';
