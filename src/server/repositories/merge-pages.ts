import 'server-only';

// k-way merge of cursor-paged sources into one page (Files: share files +
// chat attachments). Each source pages on its own; the merged cursor keeps
// one position per source. Spec: docs/admin/03-features/09-files-and-storage.md
// ("Merge": cursor = base64 JSON { s, c, l }).

/** One item of a source, e.g. one message (all its attachments stay together). */
export type MergeUnit<T> = {
  /** Higher comes first. Negate for an ascending source. */
  sortKey: number;
  rows: T[];
  /** The source's own cursor that resumes right after this unit. */
  cursor: string;
};

export type MergeFetch<T> = (cursor: string | null, limit: number) => Promise<{ units: MergeUnit<T>[]; done: boolean }>;

export type MergeSource<T> = { key: string; fetch: MergeFetch<T> };

type SourceState = { c: string | null; d?: 1 };
type MergeState = Record<string, SourceState>;

export function encodeMergeCursor(state: MergeState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

/** Unknown or broken cursors start from the first page. */
export function decodeMergeCursor(cursor: string | null | undefined, keys: readonly string[]): MergeState {
  const fresh: MergeState = Object.fromEntries(keys.map((k) => [k, { c: null }]));
  if (!cursor) return fresh;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (!parsed || typeof parsed !== 'object') return fresh;
    const out: MergeState = {};
    for (const key of keys) {
      const s = (parsed as Record<string, unknown>)[key];
      if (!s || typeof s !== 'object') return fresh;
      const { c, d } = s as { c?: unknown; d?: unknown };
      if (c !== null && typeof c !== 'string') return fresh;
      out[key] = d === 1 ? { c, d: 1 } : { c };
    }
    return out;
  } catch {
    return fresh;
  }
}

/**
 * Reads up to `limit` units from every source that is not done, then takes
 * units in sortKey order (ties: source order) until `limit` rows are taken.
 * Within a source the order is the source's own, so no row is skipped or
 * repeated across pages. Cost: up to `limit` units per source per page.
 */
export async function mergePages<T>(
  sources: readonly MergeSource<T>[],
  cursor: string | null | undefined,
  limit: number,
): Promise<{ rows: T[]; nextCursor: string | null }> {
  const keys = sources.map((s) => s.key);
  const state = decodeMergeCursor(cursor, keys);
  const active = sources.filter((s) => !state[s.key].d);
  // A source that returns nothing is done, whatever it says (no endless pages).
  const fetched = (await Promise.all(active.map((s) => s.fetch(state[s.key].c, limit)))).map((f) => ({
    units: f.units,
    done: f.done || f.units.length === 0,
  }));

  const heads = fetched.map(() => 0);
  const rows: T[] = [];
  merge: while (rows.length < limit) {
    let best = -1;
    for (let i = 0; i < fetched.length; i++) {
      const unit = fetched[i].units[heads[i]];
      if (!unit) {
        // This source has more than we fetched: its next unit could sort
        // first, so stop here and resume from the cursors.
        if (!fetched[i].done) break merge;
        continue;
      }
      if (best === -1 || unit.sortKey > fetched[best].units[heads[best]].sortKey) best = i;
    }
    if (best === -1) break;
    rows.push(...fetched[best].units[heads[best]].rows);
    heads[best]++;
  }

  const next: MergeState = { ...state };
  active.forEach((source, i) => {
    const { units, done } = fetched[i];
    const taken = heads[i];
    if (taken === units.length && done) next[source.key] = { c: null, d: 1 };
    else if (taken > 0) next[source.key] = { c: units[taken - 1].cursor };
  });
  const finished = keys.every((k) => next[k].d);
  return { rows, nextCursor: finished ? null : encodeMergeCursor(next) };
}
