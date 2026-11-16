import type { Permission } from '@/server/auth/permissions';
import { isNavItemActive, type NavGroup } from './nav';

// Command palette static items (16-command-palette.md "Static items").
// Pages come from the SAME filtered nav groups the sidebar renders, so a new
// sidebar entry is a palette entry with no change here. Actions are listed
// once below; the server (AdminShell) sends only the ids the role may use,
// so hidden actions are never in the HTML. Pure data and helpers: no React.

export type PaletteActionId = 'new-block' | 'toggle-theme' | 'toggle-pin' | 'copy-url' | 'sign-out' | 'sign-out-everywhere';

type PaletteActionDef = {
  id: PaletteActionId;
  label: string;
  /** null: any admin role. */
  permission: Permission | null;
  /** Extra words the filter matches (not shown). */
  keywords: string;
};

/**
 * Not here on purpose: "Find orphan files" (no orphans view exists on the
 * Files screen yet). Destructive actions never run from the palette: each
 * entry opens the same dialog its screen uses, or is harmless.
 */
export const PALETTE_ACTIONS: readonly PaletteActionDef[] = [
  { id: 'new-block', label: 'New block…', permission: 'blocks:write', keywords: 'block ip ban country user device' },
  { id: 'toggle-theme', label: 'Toggle theme', permission: null, keywords: 'dark light mode' },
  { id: 'toggle-pin', label: 'Pin or unpin sidebar', permission: null, keywords: 'sidebar collapse expand' },
  { id: 'copy-url', label: 'Copy current URL', permission: null, keywords: 'link share' },
  { id: 'sign-out', label: 'Sign out', permission: null, keywords: 'log out logout' },
  { id: 'sign-out-everywhere', label: 'Sign out everywhere…', permission: null, keywords: 'log out all devices' },
];

/** Server side: the action ids `isAllowed` grants, in list order. */
export function allowedPaletteActions(isAllowed: (permission: Permission) => boolean): PaletteActionId[] {
  return PALETTE_ACTIONS.filter((a) => a.permission === null || isAllowed(a.permission)).map((a) => a.id);
}

export type PaletteGroupId = 'recent' | 'pages' | 'actions';

export type PaletteEntry = {
  id: string;
  title: string;
  subtitle?: string | null;
  href: string | null;
  actionId: PaletteActionId | null;
  keywords?: string;
};

/** Every page in the (already role-filtered) nav groups, in sidebar order. */
export function pageEntries(groups: readonly NavGroup[]): PaletteEntry[] {
  return groups.flatMap((group) =>
    group.items.map((item) => ({
      id: `page:${item.href}`,
      title: item.label,
      subtitle: group.label,
      href: item.href,
      actionId: null,
      keywords: group.label ?? undefined,
    })),
  );
}

export function actionEntries(ids: readonly PaletteActionId[]): PaletteEntry[] {
  const allowed = new Set(ids);
  return PALETTE_ACTIONS.filter((a) => allowed.has(a.id)).map((a) => ({
    id: `action:${a.id}`,
    title: a.label,
    href: null,
    actionId: a.id,
    keywords: a.keywords,
  }));
}

// ---------------------------------------------------------------------------
// Filtering

/**
 * Indexes of `query`'s letters in `text` (case-insensitive): a substring
 * match if there is one, else the letters in order. null when it does not match.
 */
export function matchIndexes(query: string, text: string): number[] | null {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) return Array.from({ length: q.length }, (_, i) => at + i);
  const out: number[] = [];
  let from = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    out.push(i);
    from = i + 1;
  }
  return out;
}

export type ScoredEntry = { entry: PaletteEntry; matches: number[] };

/** Entries that match `query`, best first: title prefix, title substring, title letters, keywords. Stable within a tier. */
export function filterEntries(entries: readonly PaletteEntry[], query: string): ScoredEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.map((entry) => ({ entry, matches: [] }));
  const scored: (ScoredEntry & { tier: number; order: number })[] = [];
  entries.forEach((entry, order) => {
    const title = entry.title.toLowerCase();
    const matches = matchIndexes(q, entry.title);
    if (matches) {
      const tier = title.startsWith(q) ? 0 : title.includes(q) ? 1 : 2;
      scored.push({ entry, matches, tier, order });
    } else if (entry.keywords?.toLowerCase().includes(q)) {
      scored.push({ entry, matches: [], tier: 3, order });
    }
  });
  return scored.sort((a, b) => a.tier - b.tier || a.order - b.order).map(({ entry, matches }) => ({ entry, matches }));
}

// ---------------------------------------------------------------------------
// Recent (localStorage `sf-admin-recent`: ids, titles and links only)

export const RECENT_KEY = 'sf-admin-recent';
export const RECENT_MAX = 5;

type StoredRecent = { id: string; title: string; href: string };

function isStoredRecent(value: unknown): value is StoredRecent {
  const v = value as Partial<StoredRecent> | null;
  return Boolean(v) && typeof v?.id === 'string' && typeof v.title === 'string' && typeof v.href === 'string' && v.href.startsWith('/admin');
}

/** Recent links the role may still open: their path must belong to a page in `pages`. */
export function readRecent(storage: Pick<Storage, 'getItem'> | null, pages: readonly PaletteEntry[]): PaletteEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const hrefs = pages.map((p) => p.href).filter((h): h is string => Boolean(h));
  return raw
    .filter(isStoredRecent)
    .filter((r) => hrefs.some((href) => isNavItemActive(href, r.href.split('?')[0])))
    .slice(0, RECENT_MAX)
    .map((r) => ({ id: `recent:${r.id}`, title: r.title, href: r.href, actionId: null }));
}

/**
 * Remembers an opened link, newest first, at most 5. `withIp: false` drops
 * rows whose title or link holds an IP (roles without `ip:read`).
 */
export function pushRecent(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  item: { id: string; title: string; href: string },
  withIp: boolean,
): void {
  if (!storage) return;
  if (!withIp && /\d{1,3}(\.\d{1,3}){3}|[0-9a-f]{0,4}:[0-9a-f]{0,4}:/i.test(`${item.title} ${item.href}`)) return;
  const id = item.id.replace(/^recent:/, '');
  try {
    const current = JSON.parse(storage.getItem(RECENT_KEY) ?? '[]') as unknown;
    const list = (Array.isArray(current) ? current.filter(isStoredRecent) : []).filter((r) => r.id !== id);
    storage.setItem(RECENT_KEY, JSON.stringify([{ id, title: item.title, href: item.href }, ...list].slice(0, RECENT_MAX)));
  } catch {
    // Storage blocked or full: recent is a convenience only.
  }
}
