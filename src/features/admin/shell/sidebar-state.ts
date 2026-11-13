// Sidebar pin preference and the ⌘B / Ctrl+B shortcut. Pure, so the server
// (cookie read for first paint) and the client (toggle) share one definition.
// Spec: docs/admin/02-design/03-layout-and-sidebar.md ("Pin preference") and
// 04-responsive.md ("Sidebar default per viewport"). Decision T-16.

export const SIDEBAR_COOKIE = 'sf_admin_sidebar';
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** What the user chose. Stored in the cookie. */
export type SidebarPin = 'pinned' | 'rail';

/**
 * `data-sidebar` on the shell. `auto` = no cookie yet: CSS shows the rail
 * below 1280 px and the pinned sidebar from 1280 px, so first paint is right
 * without knowing the width on the server.
 */
export type SidebarMode = SidebarPin | 'auto';

/** Width breakpoints (px) the CSS in shell.css uses for the same decision. */
export const PIN_MIN_WIDTH = 1024;
export const AUTO_PIN_MIN_WIDTH = 1280;

export function parseSidebarCookie(raw: string | null | undefined): SidebarMode {
  return raw === 'pinned' || raw === 'rail' ? raw : 'auto';
}

/** `document.cookie` value. Path /admin, 1 year, SameSite=Lax; Secure on https. */
export function sidebarCookie(pin: SidebarPin, secure: boolean): string {
  return `${SIDEBAR_COOKIE}=${pin}; Path=/admin; Max-Age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** What the sidebar looks like at this width (≥ 768 px; below that it is a drawer). */
export function effectivePin(mode: SidebarMode, viewportWidth: number): SidebarPin {
  if (mode === 'rail' || viewportWidth < PIN_MIN_WIDTH) return 'rail';
  if (mode === 'pinned') return 'pinned';
  return viewportWidth >= AUTO_PIN_MIN_WIDTH ? 'pinned' : 'rail';
}

/** The pin the toggle should write: the opposite of what the user sees now. */
export function nextPin(mode: SidebarMode, viewportWidth: number): SidebarPin {
  return effectivePin(mode, viewportWidth) === 'pinned' ? 'rail' : 'pinned';
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat'>;

/** ⌘B on Apple, Ctrl+B elsewhere (either is accepted). No Alt/Shift, no key repeat. */
export function isPinShortcut(e: KeyLike): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !e.repeat && e.key.toLowerCase() === 'b';
}

type TargetLike = { tagName?: string; isContentEditable?: boolean } | null;

/** Shortcuts are ignored while typing: input, textarea, select, contenteditable. */
export function isTypingTarget(target: TargetLike): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
