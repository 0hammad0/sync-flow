import { describe, expect, it } from 'vitest';

import { mapAllowed } from '@/features/admin/clicks/constants';
import { clickPoints, rageDeadRows, rankTargets, selectClicks } from '@/features/admin/clicks/rows';
import { parseClicksParams } from '@/features/admin/clicks/schemas';
import { toClickSample } from '@/server/analytics/click-sample';
import { emptySession, foldRollup, emptyRollup, type ClickEntry, type SessionDoc } from '@/server/analytics/model';
import { toSessionDetail } from '@/server/analytics/session-dto';

const T0 = Date.parse('2026-11-13T10:00:00.000Z');

function click(over: Partial<ClickEntry> = {}): ClickEntry {
  return {
    ts: new Date(T0 + 10_000),
    path: '/',
    target: 'room-create',
    label: 'Start a room',
    x_pct: 50,
    y_px: 400,
    doc_h: 1_600,
    vw_bucket: 'lg',
    rage: false,
    dead: false,
    ...over,
  };
}

function session(id: string, clicks: ClickEntry[], paths: string[] = ['/']): SessionDoc {
  const s = emptySession(id.padEnd(32, '0'), new Date(T0));
  s.started_at = new Date(T0);
  paths.forEach((path, i) => {
    s.pages[`p${i}`] = { path, ts: new Date(T0 + i * 60_000), engaged_ms: 1_000, scroll_max: 50 };
  });
  s.clicks = clicks;
  return s;
}

describe('click sample', () => {
  const docs = [
    session('a', [click(), click({ rage: true }), click({ target: 'nav > a', label: null, x_pct: 10, vw_bucket: 'sm' })]),
    session('b', [click({ dead: true }), click({ path: '/send', target: 'files-upload', label: 'Upload' })], ['/', '/send']),
  ];

  it('stores each string once and every click as numbers', () => {
    const sample = toClickSample(docs);
    expect(sample.sessions).toBe(2);
    expect(sample.ids).toEqual([docs[0].id, docs[1].id]);
    expect(sample.targets).toEqual(['room-create', 'nav > a', 'files-upload']);
    expect(sample.pageviews).toEqual({ '/': 2, '/send': 1 });
    expect(sample.rows).toHaveLength(5 * 10);
  });

  it('stops at the point cap and says so', () => {
    const sample = toClickSample(docs, 2);
    expect(sample.truncated).toBe(true);
    expect(sample.rows).toHaveLength(2 * 10);
    expect(sample.sessions).toBe(1);
  });

  it('filters by path and viewport in memory', () => {
    const sample = toClickSample(docs);
    expect(selectClicks(sample, { path: '/', vw: 'lg' })).toHaveLength(3);
    expect(selectClicks(sample, { path: '/', vw: 'sm' })).toEqual([
      expect.objectContaining({ target: 'nav > a', label: null, xPct: 10, vw: 'sm', kind: 'click' }),
    ]);
    expect(selectClicks(sample, { path: '/terms', vw: 'lg' })).toEqual([]);
  });

  it('ranks targets with rage and dead rates and share of views', () => {
    const rows = selectClicks(toClickSample(docs), { path: '/', vw: 'lg' });
    const [top] = rankTargets(rows, 2);
    expect(top).toMatchObject({ target: 'room-create', label: 'Start a room', clicks: 1, sessions: 1, rage: 1, dead: 1, ragePct: 1, deadPct: 1 });
    expect(top.shareOfViews).toBe(0.5);
  });

  it('lists rage and dead by path + target and links the latest session', () => {
    const rows = selectClicks(toClickSample(docs), { path: null, vw: 'lg' });
    const sample = toClickSample(docs);
    expect(rageDeadRows(rows, 'rage', sample.ids)).toEqual([
      expect.objectContaining({ path: '/', target: 'room-create', count: 1, sessions: 1, lastSessionId: docs[0].id }),
    ]);
    expect(rageDeadRows(rows, 'dead', sample.ids)[0].lastSessionId).toBe(docs[1].id);
  });

  it('map dots: x as 0–1, rage / dead flagged, target index from the ranking', () => {
    const rows = selectClicks(toClickSample(docs), { path: '/', vw: 'lg' });
    const points = clickPoints(rows, ['room-create']);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: 0.5, y: 400, docH: 1_600, rage: false, dead: false, target: 0 });
    expect(points.filter((p) => p.rage)).toHaveLength(1);
    expect(points.filter((p) => p.dead)).toHaveLength(1);
  });
});

describe('clicks URL params', () => {
  it('falls back silently: vw → lg, view → list, mode → dots', () => {
    expect(parseClicksParams({ vw: 'xl', view: 'x', mode: 'y' })).toEqual({ path: null, pathIsKnown: true, vw: 'lg', view: 'list', mode: 'dots' });
  });

  it('keeps a tracked path and flags an unknown one', () => {
    expect(parseClicksParams({ path: '/chat/[code]', vw: 'sm', view: 'rage' })).toMatchObject({ path: '/chat/[code]', pathIsKnown: true, vw: 'sm', view: 'rage' });
    expect(parseClicksParams({ path: '/nope' }).pathIsKnown).toBe(false);
  });

  it('maps only static pages that run no app logic', () => {
    expect(['/', '/send', '/privacy', '/terms'].every(mapAllowed)).toBe(true);
    expect(['/chat', '/chat/[code]', '/receive', '/dashboard', '/login', '/share/[token]'].some(mapAllowed)).toBe(false);
  });
});

describe('session timeline clicks', () => {
  it('puts each click under the page view it happened on', () => {
    const s = session('c', [click({ ts: new Date(T0 + 70_000), path: '/send', target: 'files-upload' }), click({ ts: new Date(T0 + 5_000) })], ['/', '/send']);
    const detail = toSessionDetail(s);
    expect(detail.pages.map((p) => p.clicks.map((c) => c.target))).toEqual([['room-create'], ['files-upload']]);
    expect(detail.clickCapReached).toBe(false);
  });
});

describe('rollup click map', () => {
  it('folds the long tail of clicks.{path} by total', () => {
    const r = emptyRollup();
    for (let i = 0; i < 5; i++) r.clicks[`p${i}`] = { total: i + 1, rage: 1, dead: 0 };
    const folded = foldRollup(r, 3);
    expect(Object.keys(folded.clicks).sort()).toEqual(['_other', 'p3', 'p4']);
    expect(folded.clicks._other).toEqual({ total: 6, rage: 3, dead: 0 });
  });
});
