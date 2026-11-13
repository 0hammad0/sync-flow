// Class strings shared by server and client parts of the shell. Plain module:
// importing it from a client component pulls in nothing else.

/** Shared row look for nav links and footer buttons. 36 px (40 on touch); icon at x = 24 in the rail. */
export const SIDEBAR_ROW =
  'admin-nav-item relative flex h-9 shrink-0 cursor-pointer items-center gap-3 overflow-hidden rounded-md pr-2 pl-4 text-sm text-fg-muted transition-colors duration-[var(--dur-1)] pointer-coarse:h-10 pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg active:bg-surface-3';
