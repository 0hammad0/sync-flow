// Links built on the server from the request's search params, so they work
// without JS and keep every other param (range, mode, sort …).

export type RawSearch = Record<string, string | string[] | undefined>;

/** `pathname?…` with `changes` applied: a string sets a key, null removes it. */
export function hrefWith(pathname: string, raw: RawSearch, changes: Record<string, string | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key in changes) continue;
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  for (const [key, value] of Object.entries(changes)) if (value !== null) params.set(key, value);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** "Last 30 days" for an empty short range: drops custom dates and paging. Null when the range is already 30 days or longer. */
export function widenRangeHref(pathname: string, raw: RawSearch, days: number): string | null {
  if (days >= 30) return null;
  return hrefWith(pathname, raw, { range: '30d', from: null, to: null, cursor: null });
}
