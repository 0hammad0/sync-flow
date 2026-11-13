import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdleStore } from '@/features/admin/live/idle';
import {
  applyPoll,
  formatAgoShort,
  initialSnapshot,
  MAX_FAILURES,
  outcomeFromResponse,
  pollInterval,
  pollMode,
  refetchOnReturn,
  type PollGate,
} from '@/features/admin/live/poll';
import { liveMapData, liveMapSummary, shortIp, timeOnSiteMs, visibleLiveSessions } from '@/features/admin/live/format';
import type { LiveSessionDto } from '@/features/admin/analytics/types';

const RUNNING: PollGate = { visible: true, idle: false, paused: false, online: true };

describe('pollMode / pollInterval (T-26)', () => {
  it('polls only while visible, online, active and not paused', () => {
    expect(pollMode(RUNNING, 'ok')).toBe('running');
    expect(pollInterval('running', 30_000)).toBe(30_000);
    expect(pollMode({ ...RUNNING, visible: false }, 'ok')).toBe('hidden');
    expect(pollMode({ ...RUNNING, idle: true }, 'ok')).toBe('idle');
    expect(pollMode({ ...RUNNING, paused: true }, 'ok')).toBe('paused');
    expect(pollMode({ ...RUNNING, online: false }, 'ok')).toBe('offline');
    for (const mode of ['hidden', 'idle', 'paused', 'offline', 'stopped'] as const) expect(pollInterval(mode, 30_000)).toBe(false);
  });

  it('keeps polling while failing; stops for budget, 401, 403 and after 3 failures', () => {
    expect(pollMode(RUNNING, 'failing')).toBe('running');
    for (const status of ['stopped', 'budget', 'unauthorized', 'forbidden'] as const) expect(pollMode(RUNNING, status)).toBe('stopped');
  });

  it('a stop beats the pause, the pause beats idle, idle beats hidden', () => {
    expect(pollMode({ visible: false, idle: true, paused: true, online: false }, 'budget')).toBe('stopped');
    expect(pollMode({ visible: false, idle: true, paused: true, online: true }, 'ok')).toBe('paused');
    expect(pollMode({ visible: false, idle: true, paused: false, online: true }, 'ok')).toBe('idle');
  });

  it('refetches on tab return / reconnect only when polling would run', () => {
    expect(refetchOnReturn({ idle: false, paused: false }, 'ok')).toBe(true);
    expect(refetchOnReturn({ idle: true, paused: false }, 'ok')).toBe(false);
    expect(refetchOnReturn({ idle: false, paused: true }, 'ok')).toBe(false);
    expect(refetchOnReturn({ idle: false, paused: false }, 'unauthorized')).toBe(false);
  });
});

describe('applyPoll', () => {
  const start = initialSnapshot({ n: 1 }, 1000);

  it('swaps in new data and resets failures', () => {
    const failed = applyPoll(start, { kind: 'failed' }, 2000);
    expect(applyPoll(failed, { kind: 'ok', data: { n: 2 } }, 3000)).toEqual({ data: { n: 2 }, status: 'ok', failures: 0, updatedAt: 3000 });
  });

  it('keeps the last data on failure and stops after 3 in a row', () => {
    let s = start;
    for (let i = 1; i < MAX_FAILURES; i++) {
      s = applyPoll(s, { kind: 'failed' }, 2000 + i);
      expect(s).toMatchObject({ status: 'failing', failures: i, data: { n: 1 }, updatedAt: 1000 });
    }
    s = applyPoll(s, { kind: 'failed' }, 9000);
    expect(s).toMatchObject({ status: 'stopped', failures: MAX_FAILURES, data: { n: 1 } });
  });

  it('records budget / 401 / 403 without dropping data', () => {
    expect(applyPoll(start, { kind: 'budget' }, 2000)).toMatchObject({ status: 'budget', data: { n: 1 } });
    expect(applyPoll(start, { kind: 'unauthorized' }, 2000).status).toBe('unauthorized');
    expect(applyPoll(start, { kind: 'forbidden' }, 2000).status).toBe('forbidden');
  });
});

describe('outcomeFromResponse', () => {
  it('maps the route answers', () => {
    expect(outcomeFromResponse(200, { state: 'ok', data: { count: 3 } })).toEqual({ kind: 'ok', data: { count: 3 } });
    expect(outcomeFromResponse(200, { state: 'budget' })).toEqual({ kind: 'budget' });
    expect(outcomeFromResponse(500, { state: 'error', errorId: 'x' })).toEqual({ kind: 'failed' });
    expect(outcomeFromResponse(502, null)).toEqual({ kind: 'failed' });
    expect(outcomeFromResponse(200, { state: 'ok' })).toEqual({ kind: 'failed' });
    expect(outcomeFromResponse(401, { ok: false })).toEqual({ kind: 'unauthorized' });
    expect(outcomeFromResponse(403, { error: 'blocked' })).toEqual({ kind: 'forbidden' });
  });
});

describe('formatAgoShort', () => {
  it('follows 11-copy.md', () => {
    expect(formatAgoShort(400)).toBe('now');
    expect(formatAgoShort(4_000)).toBe('4s ago');
    expect(formatAgoShort(3 * 60_000 + 5_000)).toBe('3m ago');
    expect(formatAgoShort(5 * 3_600_000)).toBe('5h ago');
  });
});

describe('createIdleStore (10 min without input)', () => {
  const TEN_MIN = 10 * 60_000;
  let target: EventTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    target = new EventTarget();
  });
  afterEach(() => vi.useRealTimers());

  it('goes idle after 10 min with no input and tells its listeners', () => {
    const store = createIdleStore({ timeoutMs: TEN_MIN, target });
    const listener = vi.fn();
    store.subscribe(listener);
    vi.advanceTimersByTime(TEN_MIN - 1);
    expect(store.getSnapshot()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('any input restarts the 10 min', () => {
    const store = createIdleStore({ timeoutMs: TEN_MIN, target });
    store.subscribe(() => {});
    vi.advanceTimersByTime(9 * 60_000);
    target.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(9 * 60_000);
    target.dispatchEvent(new Event('pointermove'));
    vi.advanceTimersByTime(9 * 60_000);
    expect(store.getSnapshot()).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot()).toBe(true);
  });

  it('stays idle on new input until resume(), then watches again', () => {
    const store = createIdleStore({ timeoutMs: TEN_MIN, target });
    store.subscribe(() => {});
    vi.advanceTimersByTime(TEN_MIN);
    target.dispatchEvent(new Event('pointerdown'));
    expect(store.getSnapshot()).toBe(true);
    store.resume();
    expect(store.getSnapshot()).toBe(false);
    vi.advanceTimersByTime(TEN_MIN);
    expect(store.getSnapshot()).toBe(true);
  });

  it('stops watching (no timer) when nobody listens', () => {
    const store = createIdleStore({ timeoutMs: TEN_MIN, target });
    const unsubscribe = store.subscribe(() => {});
    unsubscribe();
    vi.advanceTimersByTime(2 * TEN_MIN);
    expect(store.getSnapshot()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('live format', () => {
  const at = '2026-11-14T12:00:00.000Z';
  const session = (id: string, over: Partial<LiveSessionDto>): LiveSessionDto => ({
    sessionId: id,
    ip: '203.0.113.•••',
    ipMasked: true,
    ipTruncated: false,
    country: 'PK',
    region: null,
    city: 'Lahore',
    lat: null,
    lon: null,
    device: 'mobile',
    browser: null,
    currentPath: '/',
    startedAt: '2026-11-14T11:55:48.000Z',
    lastSeenAt: '2026-11-14T11:59:50.000Z',
    userId: null,
    active: true,
    ...over,
  });

  it('time on site runs to the poll while active, to the last heartbeat after leaving', () => {
    expect(timeOnSiteMs(session('a', {}), at)).toBe(252_000);
    expect(timeOnSiteMs(session('a', { active: false }), at)).toBe(242_000);
    expect(timeOnSiteMs(session('a', { startedAt: null }), at)).toBeNull();
  });

  it('lists active visitors first and keeps a leaver for one poll only', () => {
    const rows = visibleLiveSessions(
      [
        session('left-now', { active: false, lastSeenAt: '2026-11-14T11:58:30.000Z' }),
        session('active', {}),
        session('left-long-ago', { active: false, lastSeenAt: '2026-11-14T11:56:00.000Z' }),
      ],
      at,
    );
    expect(rows.map((r) => r.sessionId)).toEqual(['active', 'left-now']);
  });

  it('maps online visitors per country and says so', () => {
    const data = liveMapData([session('a', {}), session('b', {}), session('c', { country: 'US' }), session('d', { active: false }), session('e', { country: null })]);
    expect(data).toEqual([
      { country: 'PK', value: 2 },
      { country: 'US', value: 1 },
    ]);
    expect(liveMapSummary(data)).toBe('3 people online in 2 countries.');
  });

  it('shortens long IPv6 in the middle', () => {
    expect(shortIp('203.0.113.7')).toBe('203.0.113.7');
    expect(shortIp('2001:db8:85a3:0:0:8a2e:370:7334')).toBe('2001:db8:…:7334');
    expect(shortIp(null)).toBe('—');
  });
});
