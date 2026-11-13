import type { Permission } from '@/server/auth/permissions';

// Admin navigation: one source for the sidebar, the mobile drawer and the
// breadcrumbs. Pure data, no icons (they are mapped in SidebarItem on the
// server), so client components can import it for labels at almost no cost.
// Spec: docs/admin/02-design/03-layout-and-sidebar.md ("Sidebar content").

export type NavIcon =
  | 'overview'
  | 'live'
  | 'sessions'
  | 'pages'
  | 'clicks'
  | 'geography'
  | 'sources'
  | 'files'
  | 'rooms'
  | 'users'
  | 'access'
  | 'audit'
  | 'health'
  | 'settings';

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** The permission the page itself checks. Items the role cannot use are hidden, not disabled. */
  permission: Permission;
};

/** `label: null` is the first, unlabelled group (Overview). */
export type NavGroup = { id: string; label: string | null; items: NavItem[] };

export const ADMIN_HOME = '/admin';

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'home',
    label: null,
    items: [{ href: ADMIN_HOME, label: 'Overview', icon: 'overview', permission: 'analytics:read' }],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    items: [
      { href: '/admin/live', label: 'Live', icon: 'live', permission: 'analytics:read' },
      { href: '/admin/sessions', label: 'Sessions', icon: 'sessions', permission: 'analytics:read' },
      { href: '/admin/pages', label: 'Pages', icon: 'pages', permission: 'analytics:read' },
      { href: '/admin/clicks', label: 'Clicks', icon: 'clicks', permission: 'analytics:read' },
      { href: '/admin/geography', label: 'Geography', icon: 'geography', permission: 'analytics:read' },
      { href: '/admin/sources', label: 'Sources', icon: 'sources', permission: 'analytics:read' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    items: [
      { href: '/admin/files', label: 'Files & storage', icon: 'files', permission: 'files:read' },
      { href: '/admin/rooms', label: 'Rooms', icon: 'rooms', permission: 'rooms:read' },
      { href: '/admin/users', label: 'Users', icon: 'users', permission: 'users:read' },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    items: [
      { href: '/admin/access', label: 'Access control', icon: 'access', permission: 'blocks:read' },
      { href: '/admin/audit', label: 'Audit log', icon: 'audit', permission: 'audit:read' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      // 06-states.md marks Health's permission [U]; analytics:read until decided.
      { href: '/admin/health', label: 'Health', icon: 'health', permission: 'analytics:read' },
      { href: '/admin/settings', label: 'Settings', icon: 'settings', permission: 'settings:write' },
    ],
  },
];

/** Groups with only the items `isAllowed` grants. Empty groups are dropped. */
export function filterNav(
  groups: readonly NavGroup[],
  isAllowed: (permission: Permission) => boolean,
): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => isAllowed(item.permission)) }))
    .filter((group) => group.items.length > 0);
}

/** Overview is active only on /admin itself; every other item also owns its sub-paths. */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === ADMIN_HOME) return pathname === ADMIN_HOME;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type Crumb = { label: string; href: string };

const ID_CRUMB_MAX = 8;

/** Long ids in the trail read as "7f3a9c2e…"; the page title has the full value. */
function segmentLabel(segment: string): string {
  let text = segment;
  try {
    text = decodeURIComponent(segment);
  } catch {
    // Malformed escape: show it as typed.
  }
  return text.length > ID_CRUMB_MAX ? `${text.slice(0, ID_CRUMB_MAX)}…` : text;
}

/**
 * Breadcrumb trail for an admin path. The last crumb is the current page.
 * `/admin` → Overview · `/admin/sessions/7f3a…` → Sessions / 7f3a….
 */
export function breadcrumbsFor(pathname: string, groups: readonly NavGroup[] = NAV_GROUPS): Crumb[] {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const items = groups.flatMap((group) => group.items);
  if (path === ADMIN_HOME || !path.startsWith(`${ADMIN_HOME}/`)) {
    return [{ label: 'Overview', href: ADMIN_HOME }];
  }

  const segments = path.slice(ADMIN_HOME.length + 1).split('/').filter(Boolean);
  const crumbs: Crumb[] = [];
  let href = ADMIN_HOME;
  for (const segment of segments) {
    href = `${href}/${segment}`;
    const item = items.find((i) => i.href === href);
    crumbs.push({ label: item?.label ?? segmentLabel(segment), href });
  }
  return crumbs;
}
