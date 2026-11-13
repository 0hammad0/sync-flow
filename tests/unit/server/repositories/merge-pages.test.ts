import { describe, expect, it } from 'vitest';

import { decodeMergeCursor, mergePages, type MergeSource, type MergeUnit } from '@/server/repositories/merge-pages';

/** A source over fixed units (sortKey desc), offset cursors. */
function source(key: string, items: { t: number; rows: string[] }[]): MergeSource<string> {
  const all: MergeUnit<string>[] = items.map((u) => ({ sortKey: u.t, rows: u.rows, cursor: '' }));
  return {
    key,
    fetch: async (cursor, limit) => {
      const start = cursor ? Number(cursor) : 0;
      const units = all.slice(start, start + limit).map((u, i) => ({ ...u, cursor: String(start + i + 1) }));
      return { units, done: start + limit >= all.length };
    },
  };
}

async function all(sources: MergeSource<string>[], limit: number): Promise<{ rows: string[]; pages: number }> {
  const rows: string[] = [];
  let cursor: string | null = null;
  for (let pages = 1; pages < 50; pages++) {
    const page: { rows: string[]; nextCursor: string | null } = await mergePages(sources, cursor, limit);
    rows.push(...page.rows);
    if (!page.nextCursor) return { rows, pages };
    cursor = page.nextCursor;
  }
  throw new Error('endless paging');
}

describe('mergePages', () => {
  it('merges newest first across sources and pages', async () => {
    const a = source('a', [{ t: 9, rows: ['a9'] }, { t: 5, rows: ['a5'] }, { t: 1, rows: ['a1'] }]);
    const b = source('b', [{ t: 8, rows: ['b8'] }, { t: 6, rows: ['b6a', 'b6b'] }, { t: 2, rows: ['b2'] }]);
    for (const limit of [1, 2, 3, 10]) {
      expect((await all([a, b], limit)).rows).toEqual(['a9', 'b8', 'b6a', 'b6b', 'a5', 'b2', 'a1']);
    }
  });

  it('keeps order when a source returns units with no rows', async () => {
    const a = source('a', [{ t: 10, rows: [] }, { t: 9, rows: [] }, { t: 7, rows: ['a7'] }]);
    const b = source('b', [{ t: 8, rows: ['b8'] }, { t: 1, rows: ['b1'] }]);
    expect((await all([a, b], 2)).rows).toEqual(['b8', 'a7', 'b1']);
  });

  it('ends on an empty source and returns no cursor when everything is read', async () => {
    const page = await mergePages([source('a', [])], null, 5);
    expect(page).toEqual({ rows: [], nextCursor: null });
  });

  it('treats a broken or foreign cursor as the first page', () => {
    expect(decodeMergeCursor('not-base64-json', ['s'])).toEqual({ s: { c: null } });
    expect(decodeMergeCursor(Buffer.from('{"x":1}').toString('base64url'), ['s'])).toEqual({ s: { c: null } });
  });
});
