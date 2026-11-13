// Sessions screen constants, zod-free so client components can import them
// without pulling zod into the page's first-load JS. schemas.ts builds on these.

export const SESSION_DEVICES = ['mobile', 'tablet', 'desktop'] as const;
export type SessionDevice = (typeof SESSION_DEVICES)[number];

export const DEVICE_LABELS: Record<SessionDevice, string> = { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop' };

/** Precedence when a URL carries more than one filter (the spec's `?q&country&device` order). */
export const FILTER_KEYS = ['q', 'country', 'device'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const FILTER_KEY_LABELS: Record<FilterKey, string> = { q: 'search', country: 'country', device: 'device' };

/** Why the search box text was not used. */
export type SearchProblem = 'invalid' | 'ip_not_allowed';

export const SEARCH_PROBLEM_TEXT: Record<SearchProblem, string> = {
  invalid: 'Not a full IP address or user id. Search takes one of those, exactly.',
  ip_not_allowed: 'Your role cannot search by IP. Search by user id instead.',
};

/** Pages of "Newer" history kept in the URL (~60 chars each). Older steps fall back to the first page. */
export const MAX_CURSOR_DEPTH = 40;

/** sessionStorage key: the detail page's back link returns to the list with its filters. */
export const SESSIONS_BACK_KEY = 'sf_admin_sessions_back';
