import { describe, expect, it } from 'vitest';

import type { FlowRow, PageRow } from '@/features/admin/analytics/types';
import { flowItems, flowLabel } from '@/features/admin/pages/components/PageFlowList';
import { isKnownPath, pagePathLabel } from '@/features/admin/pages/constants';
import { formatAvgTime, formatRate, formatScroll, middleTruncate, sampleNote, spokenRate } from '@/features/admin/pages/format';
import { hrefWith, widenRangeHref } from '@/features/admin/pages/links';
import { matchesPath, selectPageRows, sortForMode, sortPageRows, toTableRow } from '@/features/admin/pages/rows';

function row(path: string, over: Partial<PageRow> = {}): PageRow {
  const other = path === '_other';
  return {
    path,
    label: other ? 'Other pages' : path,
    other,
    pageviews: 10,
    visitors: 5,
    sessions: 5,
    entries: 4,
    exits: 3,
    avgEngagedMs: 30_000,
    bounceRate: 0.25,
    exitRate: 0.3,
    avgScroll: 50,
    share: 0.1,
    ...over,
  };
}

describe('bucket labels', () => {
  it('names the fold and no-path buckets in plain words and never links them', () => {
    expect(pagePathLabel('_other')).toBe('Other pages');
    expect(pagePathLabel('(none)')).toBe('Unknown page');
    expect(pagePathLabel('/chat/[code]')).toBe('/chat/[code]');

    expect(toTableRow(row('_other'))).toMatchObject({ label: 'Other pages', linkable: false });
    expect(toTableRow(row('(none)', { label: '(none)' }))).toMatchObject({ label: 'Unknown page', linkable: false });
    expect(toTableRow(row('/'))).toMatchObject({ label: '/', linkable: true });
  });

  it('only tracked route patterns open the detail panel', () => {
    expect(isKnownPath('/chat/[code]')).toBe(true);
    expect(isKnownPath('/chat/ABCD2345')).toBe(false);
    expect(isKnownPath('/admin')).toBe(false);
    expect(isKnownPath('_other')).toBe(false);
    expect(isKnownPath(null)).toBe(false);
  });
});

describe('search', () => {
  it('is a case-insensitive prefix match with an implied leading slash', () => {
    expect(matchesPath(row('/chat/[code]'), 'chat')).toBe(true);
    expect(matchesPath(row('/chat/[code]'), '/CHAT/')).toBe(true);
    expect(matchesPath(row('/dashboard'), 'chat')).toBe(false);
    expect(matchesPath(row('/share/[token]'), 'token')).toBe(false);
  });

  it('never matches the buckets, and an empty search matches everything', () => {
    expect(matchesPath(row('_other'), 'o')).toBe(false);
    expect(matchesPath(row('(none)'), 'none')).toBe(false);
    expect(matchesPath(row('_other'), '  ')).toBe(true);
  });
});

describe('sorting', () => {
  const rows = [
    row('_other', { pageviews: 999 }),
    row('/a', { pageviews: 5, bounceRate: null }),
    row('/b', { pageviews: 50, bounceRate: 0.9 }),
    row('(none)', { pageviews: 500 }),
    row('/c', { pageviews: 20, bounceRate: 0.1 }),
  ];

  it('keeps the buckets last whatever the sort', () => {
    expect(sortPageRows(rows, '-pageviews').map((r) => r.path)).toEqual(['/b', '/c', '/a', '_other', '(none)']);
    expect(sortPageRows(rows, 'pageviews').map((r) => r.path).slice(0, 3)).toEqual(['/a', '/c', '/b']);
  });

  it('puts rates with nothing to divide by last in both directions', () => {
    expect(sortPageRows(rows, '-bounceRate').map((r) => r.path).slice(0, 3)).toEqual(['/b', '/c', '/a']);
    expect(sortPageRows(rows, 'bounceRate').map((r) => r.path).slice(0, 3)).toEqual(['/c', '/b', '/a']);
  });

  it('sorts paths alphabetically', () => {
    expect(sortPageRows([row('/c'), row('/a'), row('/b')], 'path').map((r) => r.path)).toEqual(['/a', '/b', '/c']);
  });

  it('falls back to the mode default for a sort the mode does not have', () => {
    expect(sortForMode('all', '-entries')).toBe('-pageviews');
    expect(sortForMode('entry', '-entries')).toBe('-entries');
    expect(sortForMode('exit', null)).toBe('-exits');
    expect(sortForMode('exit', 'exitRate')).toBe('exitRate');
  });
});

describe('selectPageRows', () => {
  const many = Array.from({ length: 60 }, (_, i) => row(`/p${String(i).padStart(2, '0')}`, { pageviews: 100 - i, entries: i % 2, exits: i % 3 === 0 ? 2 : 0 }));

  it('pages 25 at a time with offset cursors', () => {
    const first = selectPageRows(many, { q: '', mode: 'all', sort: '-pageviews', cursor: 0 });
    expect(first.rows).toHaveLength(25);
    expect(first.total).toBe(60);
    expect(first.prevCursor).toBeNull();
    expect(first.nextCursor).toBe('25');
    expect(first.max).toBe(100);

    const second = selectPageRows(many, { q: '', mode: 'all', sort: '-pageviews', cursor: 25 });
    expect(second.rows[0].path).toBe('/p25');
    expect(second.prevCursor).toBe(''); // FIRST_PAGE_CURSOR: the newer page is the first
    expect(second.nextCursor).toBe('50');

    const last = selectPageRows(many, { q: '', mode: 'all', sort: '-pageviews', cursor: 50 });
    expect(last.rows).toHaveLength(10);
    expect(last.prevCursor).toBe('25');
    expect(last.nextCursor).toBeNull();
  });

  it('shows the last page for an offset past the end, and snaps odd offsets', () => {
    expect(selectPageRows(many, { q: '', mode: 'all', sort: '-pageviews', cursor: 900 }).rows[0].path).toBe('/p50');
    expect(selectPageRows(many, { q: '', mode: 'all', sort: '-pageviews', cursor: 30 }).rows[0].path).toBe('/p25');
  });

  it('entry and exit modes keep only paths with entries / exits, and share against all of them', () => {
    const entry = selectPageRows(many, { q: '', mode: 'entry', sort: '-entries', cursor: 0 });
    expect(entry.total).toBe(30);
    expect(entry.base).toBe(30);
    expect(entry.rows.every((r) => r.entries > 0)).toBe(true);

    const exit = selectPageRows(many, { q: '', mode: 'exit', sort: '-exits', cursor: 0 });
    expect(exit.total).toBe(20);
    expect(exit.base).toBe(40);
    expect(exit.max).toBe(2);
  });

  it('searches before paging; an empty list has no cursors', () => {
    const found = selectPageRows(many, { q: 'p1', mode: 'all', sort: '-pageviews', cursor: 0 });
    expect(found.total).toBe(10);
    expect(found.nextCursor).toBeNull();
    const none = selectPageRows([], { q: '', mode: 'all', sort: '-pageviews', cursor: 50 });
    expect(none).toMatchObject({ rows: [], total: 0, max: 0, prevCursor: null, nextCursor: null });
  });
});

describe('formatting', () => {
  it('rates, time and scroll', () => {
    expect(formatRate(0.412)).toBe('41.2%');
    expect(formatRate(null)).toBeNull();
    expect(spokenRate(0.094)).toBe('9.4 percent');
    expect(formatAvgTime(0)).toBe('0s');
    expect(formatAvgTime(370_000)).toBe('6m 10s');
    expect(formatAvgTime(null)).toBeNull();
    expect(formatScroll(61.6)).toBe('62%');
  });

  it('middle-truncates long paths and leaves short ones', () => {
    expect(middleTruncate('/chat/[code]', 48)).toBe('/chat/[code]');
    const cut = middleTruncate(`/a/${'x'.repeat(80)}/end`, 20);
    expect(cut).toHaveLength(20);
    expect(cut.startsWith('/a/')).toBe(true);
    expect(cut.endsWith('/end')).toBe(true);
  });

  it('says how big the flow sample is', () => {
    expect(sampleNote({ sampleSize: 500, from: '2026-10-16', to: '2026-11-14' })).toBe(
      'Based on the latest 500 sessions, 16 Oct – 14 Nov 2026.',
    );
    expect(sampleNote({ sampleSize: 12, from: '2026-11-13', to: '2026-11-14' })).toBe('Based on all 12 sessions, 13 Nov – 14 Nov 2026.');
    expect(sampleNote({ sampleSize: 1, from: '2026-11-14', to: '2026-11-14' })).toBe('Based on all 1 session, 14 Nov 2026.');
    expect(sampleNote({ sampleSize: 0, from: '2026-11-14', to: '2026-11-14' })).toBe('No sessions in 14 Nov 2026.');
  });
});

describe('page flow rows', () => {
  const flow: FlowRow[] = [
    { kind: 'entry', path: null, count: 6, share: 0.6 },
    { kind: 'page', path: '/', count: 3, share: 0.3 },
    { kind: 'page', path: '_other', count: 1, share: 0.1 },
  ];

  it('labels session edges in plain words and links only known paths', () => {
    expect(flowLabel({ kind: 'exit', path: null, count: 1, share: 1 })).toBe('Left the site');
    expect(flowItems(flow, (p) => `/admin/pages?path=${encodeURIComponent(p)}`)).toEqual([
      { label: 'Started here', value: 6, href: undefined },
      { label: '/', value: 3, href: '/admin/pages?path=%2F' },
      { label: 'Other pages', value: 1, href: undefined },
    ]);
  });
});

describe('links', () => {
  it('keeps the other params and applies the changes', () => {
    expect(hrefWith('/admin/pages', { range: '30d', mode: 'exit', path: '/' }, { path: '/chat' })).toBe(
      '/admin/pages?range=30d&mode=exit&path=%2Fchat',
    );
    expect(hrefWith('/admin/pages', { path: '/' }, { path: null })).toBe('/admin/pages');
  });

  it('offers "Last 30 days" only for shorter ranges, dropping custom dates and the page', () => {
    expect(widenRangeHref('/admin/pages', { range: 'custom', from: '2026-11-01', to: '2026-11-03', cursor: '25', q: '/chat' }, 3)).toBe(
      '/admin/pages?q=%2Fchat&range=30d',
    );
    expect(widenRangeHref('/admin/pages', { range: '30d' }, 30)).toBeNull();
  });
});
