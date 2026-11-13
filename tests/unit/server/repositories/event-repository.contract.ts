import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_TRACKING_SETTINGS,
  emptyRollup,
  sessionRollup,
  type Rollup,
  type SessionPatch,
} from '@/server/analytics/model';
import { encodeKey } from '@/server/firestore/encode-key';
import type { EventRepository } from '@/server/repositories/interfaces';

/**
 * One behaviour for every EventRepository (Liskov). Runs on the in-memory
 * repo in `unit` and on Firestore (emulator) in `integration`.
 * `makeRepo` must return an empty repository.
 */
export function runEventRepositoryContract(name: string, makeRepo: () => Promise<EventRepository>) {
  describe(`EventRepository contract: ${name}`, () => {
    let repo: EventRepository;
    const t0 = new Date('2026-11-13T10:15:00.000Z');
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

    beforeEach(async () => {
      repo = await makeRepo();
    });

    function patch(id: string, overrides: Partial<SessionPatch> = {}): SessionPatch {
      return {
        id,
        now: t0,
        set: {
          started_at: t0,
          rolled_up: false,
          sampled: false,
          ip: '203.0.113.7',
          ip_trunc: '203.0.113.0',
          ip_held: true,
          country: 'PK',
          region: 'PB',
          city: 'Lahore',
          lat: 31.55,
          lon: 74.34,
          device: 'mobile',
          browser: 'Chrome',
          os: 'Android',
          entry_path: '/chat/[code]',
          exit_path: '/chat/[code]',
          user_id: null,
        },
        increment: { pageviews: 1, engaged_ms: 1_000 },
        pages: { p1: { path: '/chat/[code]', ts: t0, engaged_ms: 1_000, scroll_max: 25 } },
        ...overrides,
      };
    }

    function delta(views: number, sampled = false): Rollup {
      const r = emptyRollup();
      r.views = views;
      r.sessions = 1;
      r.sampled = sampled;
      r.path[encodeKey('/chat/[code]')] = { views, sessions: 1, engaged_ms: 10, bounces: 0, entries: 1, exits: 1, scroll_sum: 25 };
      r.city[encodeKey('PK:PB:Lahore')] = { sessions: 1, views, engaged_ms: 10, bounces: 0, lat: 31.55, lon: 74.34 };
      r.country.PK = { sessions: 1, views, engaged_ms: 10, bounces: 0 };
      return r;
    }

    it('returns null for a missing session and default settings (tracking off) when there is no settings doc', async () => {
      expect(await repo.getSession('0'.repeat(32))).toBeNull();
      expect(await repo.readTrackingSettings()).toEqual(DEFAULT_TRACKING_SETTINGS);
      expect(DEFAULT_TRACKING_SETTINGS.trackingEnabled).toBe(false);
    });

    it('creates a session with one write and merges later flushes (increments, pages, overwrite)', async () => {
      const id = 'a'.repeat(32);
      await repo.writeSession(patch(id));
      await repo.writeSession({
        id,
        now: at(1),
        set: { exit_path: '/', vitals: { lcp: 1200, inp: null, cls: 0.01 } },
        increment: { pageviews: 1, engaged_ms: 2_500 },
        pages: {
          p1: { engaged_ms: 500, scroll_max: 75 },
          p2: { path: '/', ts: at(1), engaged_ms: 2_000 },
        },
      });

      const s = await repo.getSession(id);
      expect(s).not.toBeNull();
      expect(s).toMatchObject({
        id,
        ip: '203.0.113.7',
        ip_held: true,
        country: 'PK',
        city: 'Lahore',
        lat: 31.55,
        device: 'mobile',
        entry_path: '/chat/[code]',
        exit_path: '/',
        pageviews: 2,
        engaged_ms: 3_500,
        rolled_up: false,
        sampled: false,
        user_id: null,
        vitals: { lcp: 1200, inp: null, cls: 0.01 },
      });
      expect(s?.started_at?.getTime()).toBe(t0.getTime());
      expect(s?.last_seen_at.getTime()).toBe(at(1).getTime());
      expect(s?.pages.p1).toMatchObject({ path: '/chat/[code]', engaged_ms: 1_500, scroll_max: 75 });
      expect(s?.pages.p1.ts?.getTime()).toBe(t0.getTime());
      expect(s?.pages.p2).toMatchObject({ path: '/', engaged_ms: 2_000, scroll_max: 0 });
    });

    it('a final flush increments a_hourly in the same call; two sessions add up', async () => {
      await repo.writeSession(patch('b'.repeat(32)), { hour: '2026-11-13-10', delta: delta(2) });
      await repo.writeSession(patch('c'.repeat(32)), { hour: '2026-11-13-10', delta: delta(3, true) });
      const [hour, missing] = await repo.getHourly(['2026-11-13-10', '2026-11-13-11']);
      expect(missing).toBeNull();
      expect(hour).toMatchObject({ views: 5, sessions: 2, sampled: true });
      expect(hour?.path[encodeKey('/chat/[code]')]).toMatchObject({ views: 5, sessions: 2, entries: 2, scroll_sum: 50 });
      expect(hour?.city[encodeKey('PK:PB:Lahore')]).toMatchObject({ sessions: 2, lat: 31.55, lon: 74.34 });
      expect(hour?.country.PK).toMatchObject({ sessions: 2, views: 5 });
    });

    it('lists unrolled sessions last seen before a time, oldest first, and rolls one up', async () => {
      await repo.writeSession(patch('1'.repeat(32), { now: at(2) }));
      await repo.writeSession(patch('2'.repeat(32), { now: at(1) }));
      await repo.writeSession(patch('3'.repeat(32), { now: at(60) }));
      await repo.writeSession(patch('4'.repeat(32), { now: at(0), set: { ...patch('x').set, rolled_up: true } }));

      const list = await repo.listUnrolledSessions(at(30), 10);
      expect(list.map((s) => s.id)).toEqual(['2'.repeat(32), '1'.repeat(32)]);
      expect(await repo.listUnrolledSessions(at(30), 1)).toHaveLength(1);

      const session = list[0];
      await repo.rollUpSession(session.id, { hour: '2026-11-13-10', delta: sessionRollup(session) });
      expect((await repo.getSession(session.id))?.rolled_up).toBe(true);
      expect((await repo.listUnrolledSessions(at(30), 10)).map((s) => s.id)).toEqual(['1'.repeat(32)]);
      expect((await repo.getHourly(['2026-11-13-10']))[0]).toMatchObject({ sessions: 1, views: 1 });
    });

    it('overwrites a_daily (idempotent) and reads it back', async () => {
      const builtAt = new Date('2026-11-14T04:00:00.000Z');
      await repo.putDaily({ ...delta(9), day: '2026-11-13', built_at: builtAt });
      await repo.putDaily({ ...delta(4), day: '2026-11-13', built_at: builtAt });
      const daily = await repo.getDaily('2026-11-13');
      expect(daily).toMatchObject({ day: '2026-11-13', views: 4, sessions: 1 });
      expect(daily?.built_at.getTime()).toBe(builtAt.getTime());
      expect(daily?.path[encodeKey('/chat/[code]')]).toMatchObject({ views: 4 });
      expect(await repo.getDaily('2026-11-12')).toBeNull();
    });

    it('nulls full IPs of sessions last seen before the cutoff, up to the limit', async () => {
      for (const [i, minutes] of [[1, 0], [2, 1], [3, 2], [4, 100]] as const) {
        await repo.writeSession(patch(String(i).repeat(32), { now: at(minutes) }));
      }
      expect(await repo.nullIps(at(50), 2)).toBe(2);
      expect(await repo.nullIps(at(50), 2)).toBe(1);
      expect(await repo.nullIps(at(50), 2)).toBe(0);
      const s = await repo.getSession('1'.repeat(32));
      expect(s).toMatchObject({ ip: null, ip_held: false, ip_trunc: '203.0.113.0' });
      expect((await repo.getSession('4'.repeat(32)))?.ip).toBe('203.0.113.7');
    });

    it('deletes old sessions, hourly docs and counters in limited batches', async () => {
      await repo.writeSession(patch('1'.repeat(32), { now: at(0) }));
      await repo.writeSession(patch('2'.repeat(32), { now: at(1) }));
      await repo.writeSession(patch('3'.repeat(32), { now: at(100) }));
      expect(await repo.deleteSessions(at(50), 1)).toBe(1);
      expect(await repo.deleteSessions(at(50), 10)).toBe(1);
      expect(await repo.getSession('3'.repeat(32))).not.toBeNull();

      for (const hour of ['2026-10-01-00', '2026-10-01-01', '2026-11-13-10']) {
        await repo.writeSession(patch('9'.repeat(32)), { hour, delta: delta(1) });
      }
      expect(await repo.deleteHourly('2026-10-30-00', 10)).toBe(2);
      expect((await repo.getHourly(['2026-11-13-10']))[0]).not.toBeNull();

      await repo.incrementCounters('2025-01-01', 'ingest', { accepted: 1 });
      await repo.incrementCounters('2026-11-13', 'ingest', { accepted: 1 });
      expect(await repo.deleteCounters('2025-11-13', 10)).toBe(1);
      expect(await repo.getCounters('2025-01-01', 'ingest')).toEqual({});
      expect(await repo.getCounters('2026-11-13', 'ingest')).toEqual({ accepted: 1 });
    });

    it('increments counters in a group and leaves other groups alone', async () => {
      await repo.incrementCounters('2026-11-13', 'ingest', { accepted: 3, dropped: 1 });
      await repo.incrementCounters('2026-11-13', 'ingest', { accepted: 2, sampled_out: 4 });
      await repo.incrementCounters('2026-11-13', 'ai', { requests: 1 });
      expect(await repo.getCounters('2026-11-13', 'ingest')).toEqual({ accepted: 5, dropped: 1, sampled_out: 4 });
      expect(await repo.getCounters('2026-11-13', 'ai')).toEqual({ requests: 1 });
      expect(await repo.getCounters('2026-11-14', 'ingest')).toEqual({});
    });

    it('does not let callers change stored docs through returned objects', async () => {
      const id = 'd'.repeat(32);
      await repo.writeSession(patch(id));
      const first = await repo.getSession(id);
      if (first) first.pages.p1.engaged_ms = 99;
      expect((await repo.getSession(id))?.pages.p1.engaged_ms).toBe(1_000);
    });
  });
}
