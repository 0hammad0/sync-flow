// Command palette server search DTO (16-command-palette.md "Search").
// Types only, so the client palette can import them for free.

/** Server groups, in the order the palette shows them (after Pages). */
export const SEARCH_GROUP_ORDER = ['ip', 'user', 'room', 'file', 'session', 'block'] as const;
export type SearchGroupId = (typeof SEARCH_GROUP_ORDER)[number];

/** A palette action a result row can start. It only ever opens a dialog. */
export type SearchItemAction = { id: 'block'; type: 'ip' | 'uid'; value: string };

export type SearchItemDto = {
  id: string;
  title: string;
  subtitle: string | null;
  /** Where Enter goes. null: an action row, or an info row ("No user with this email."). */
  href: string | null;
  action: SearchItemAction | null;
  /** The value the copy button copies (an IP, uid, code or id). Never a share token. */
  copy: string | null;
};

export type SearchGroupDto = { id: SearchGroupId; label: string; items: SearchItemDto[] };

/** `notice`: some lookups were skipped (`budget`: today's read cap; `error`: a lookup failed). */
export type SearchResultDto = { groups: SearchGroupDto[]; notice: 'budget' | 'error' | null };

/** Max rows per group (spec). */
export const SEARCH_GROUP_MAX = 5;
