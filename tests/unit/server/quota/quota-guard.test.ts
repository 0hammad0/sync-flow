import { beforeEach, describe, expect, it } from 'vitest';

import {
  CAPS_REFRESH_MS,
  DEFAULT_QUOTA_CAPS,
  FLUSH_EVENT_COUNT,
  FLUSH_INTERVAL_MS,
  QuotaExceededError,
  QuotaGuard,
  USAGE_REFRESH_MS,
  isResourceExhausted,
  nextPacificMidnight,
  readsForAggregation,
  utcDay,
  type QuotaCaps,
  type QuotaCounts,
  type QuotaStore,
} from '@/server/quota/quota-guard';

const T0 = Date.UTC(2026, 10, 13, 10, 0, 0); // 2026-11-13 10:00 UTC = 02:00 PST
const EXHAUSTED = Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), { code: 8 });

class FakeStore implements QuotaStore {
  used = new Map<string, QuotaCounts>();
  caps: Partial<QuotaCaps> | null = null;
  reads: { day: string; withCaps: boolean }[] = [];
  adds: { day: string; delta: QuotaCounts }[] = [];
  failAdds: unknown = null;
  failReads: unknown = null;

  setUsed(day: string, used: Partial<QuotaCounts>) {
    this.used.set(day, { reads: 0, writes: 0, deletes: 0, ...used });
  }

  async read(day: string, withCaps: boolean) {
    this.reads.push({ day, withCaps });
    if (this.failReads) throw this.failReads;
    return { used: { ...(this.used.get(day) ?? { reads: 0, writes: 0, deletes: 0 }) }, caps: withCaps ? this.caps : null };
  }

  async add(day: string, delta: QuotaCounts) {
    this.adds.push({ day, delta: { ...delta } });
    if (this.failAdds) throw this.failAdds;
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('QuotaGuard', () => {
  let clock: number;
  let store: FakeStore;
  let guard: QuotaGuard;
  const silent = { warn: () => {} };

  beforeEach(() => {
    clock = T0;
    store = new FakeStore();
    guard = new QuotaGuard(store, { now: () => clock, logger: silent });
  });

  describe('caps and decisions', () => {
    it('uses the default caps when settings have none', async () => {
      expect(DEFAULT_QUOTA_CAPS).toEqual({ reads: 10_000, writes: 5_000, deletes: 5_000 });
      await guard.canWrite('writes');
      expect(guard.snapshot().caps).toEqual(DEFAULT_QUOTA_CAPS);
    });

    it('takes caps from admin_config/settings.quota, defaults for missing ones', async () => {
      store.caps = { writes: 1_000 };
      await guard.canWrite('writes');
      expect(guard.snapshot().caps).toEqual({ ...DEFAULT_QUOTA_CAPS, writes: 1_000 });
    });

    it('is ok below 70% of the write cap', async () => {
      store.setUsed('2026-11-13', { writes: 3_499 });
      expect(await guard.canWrite('writes')).toBe('ok');
    });

    it('samples from 70% of the write cap', async () => {
      store.setUsed('2026-11-13', { writes: 3_500 });
      expect(await guard.canWrite('writes')).toBe('sample');
    });

    it('stops at 100% of the write cap', async () => {
      store.setUsed('2026-11-13', { writes: 4_999 });
      expect(await guard.canWrite('writes')).toBe('sample');
      guard.record('writes');
      expect(await guard.canWrite('writes')).toBe('stop');
    });

    it('never samples reads or deletes, only stops them at the cap', async () => {
      store.setUsed('2026-11-13', { reads: 9_000, deletes: 4_000 });
      expect(await guard.canWrite('reads')).toBe('ok');
      expect(await guard.canWrite('deletes')).toBe('ok');
      store.setUsed('2026-11-13', { reads: 10_000, deletes: 5_000 });
      clock += USAGE_REFRESH_MS;
      expect(await guard.canWrite('reads')).toBe('stop');
      expect(await guard.canWrite('deletes')).toBe('stop');
    });

    it('adds unflushed local counts to the stored count', async () => {
      store.setUsed('2026-11-13', { writes: 3_400 });
      expect(await guard.canWrite('writes')).toBe('ok');
      guard.record('writes', 100);
      expect(await guard.canWrite('writes')).toBe('sample');
      expect(guard.snapshot().used.writes).toBe(3_500);
    });

    it('assertCan throws QuotaExceededError at the cap', async () => {
      store.setUsed('2026-11-13', { reads: 10_000 });
      await expect(guard.assertCan('reads')).rejects.toMatchObject({ name: 'QuotaExceededError', kind: 'reads', reason: 'cap' });
      await expect(guard.assertCan('writes')).resolves.toBe('ok');
    });
  });

  describe('reading the shared counter', () => {
    it('reads a_counters at most once per 60 s and settings at most once per 5 min', async () => {
      await guard.canWrite('writes');
      await guard.canWrite('writes');
      clock += USAGE_REFRESH_MS - 1;
      await guard.canWrite('reads');
      expect(store.reads).toEqual([{ day: '2026-11-13', withCaps: true }]);

      clock += 1;
      await guard.canWrite('writes');
      expect(store.reads).toHaveLength(2);
      expect(store.reads[1].withCaps).toBe(false);

      clock = T0 + CAPS_REFRESH_MS;
      await guard.canWrite('writes');
      expect(store.reads.at(-1)?.withCaps).toBe(true);
    });

    it('shares one read between concurrent callers', async () => {
      await Promise.all([guard.canWrite('writes'), guard.canWrite('reads'), guard.canWrite('deletes')]);
      expect(store.reads).toHaveLength(1);
    });

    it('counts its own reads (counter + settings) as reads', async () => {
      await guard.canWrite('writes');
      expect(guard.snapshot().used.reads).toBe(2);
      clock += USAGE_REFRESH_MS;
      await guard.canWrite('writes');
      // stored 0 (nothing flushed yet) + 3 unflushed local reads
      expect(guard.snapshot().used.reads).toBe(3);
    });

    it('keeps the last known count when a read fails, and retries after 60 s', async () => {
      store.setUsed('2026-11-13', { writes: 3_600 });
      expect(await guard.canWrite('writes')).toBe('sample');
      store.failReads = new Error('unavailable');
      clock += USAGE_REFRESH_MS;
      expect(await guard.canWrite('writes')).toBe('sample');
      await guard.canWrite('writes');
      expect(store.reads).toHaveLength(2);
    });
  });

  describe('flushing counts to a_counters/{day}', () => {
    it('does not flush before 200 events or 5 minutes', async () => {
      guard.record('writes', FLUSH_EVENT_COUNT - 1);
      clock += FLUSH_INTERVAL_MS - 1;
      await settle();
      expect(store.adds).toEqual([]);
    });

    it('flushes once at 200 events, with one increment for the day', async () => {
      guard.record('writes', 150);
      guard.record('reads', 49);
      expect(store.adds).toEqual([]);
      guard.record('deletes', 1);
      await settle();
      expect(store.adds).toEqual([{ day: '2026-11-13', delta: { reads: 49, writes: 150, deletes: 1 } }]);
    });

    it('flushes after 5 minutes even with few events', async () => {
      guard.record('writes');
      clock += FLUSH_INTERVAL_MS;
      guard.record('writes');
      await settle();
      expect(store.adds).toEqual([{ day: '2026-11-13', delta: { reads: 0, writes: 2, deletes: 0 } }]);
    });

    it('flushes at most once per window: the next flush needs 200 new events or 5 more minutes', async () => {
      guard.record('writes', FLUSH_EVENT_COUNT);
      await settle();
      guard.record('writes', FLUSH_EVENT_COUNT - 2);
      clock += FLUSH_INTERVAL_MS - 1;
      guard.record('writes');
      await settle();
      expect(store.adds).toHaveLength(1);

      clock += 1;
      guard.record('writes');
      await settle();
      expect(store.adds).toHaveLength(2);
      // 198 + 1 + 1 recorded, plus 1 for the first flush's own write.
      expect(store.adds[1].delta.writes).toBe(201);
    });

    it('counts the flushed amount after flushing, until the next read', async () => {
      await guard.canWrite('writes');
      guard.record('writes', FLUSH_EVENT_COUNT);
      await settle();
      // stored 0 (read before the flush) + 200 flushed + 1 for the flush itself
      expect(guard.snapshot().used.writes).toBe(201);
    });

    it('keeps counts after a failed flush and sends them next time', async () => {
      store.failAdds = new Error('unavailable');
      guard.record('writes', FLUSH_EVENT_COUNT);
      await settle();
      expect(store.adds).toHaveLength(1);
      expect(guard.snapshot().used.writes).toBe(FLUSH_EVENT_COUNT);

      store.failAdds = null;
      clock += FLUSH_INTERVAL_MS;
      guard.record('writes');
      await settle();
      expect(store.adds[1].delta.writes).toBe(FLUSH_EVENT_COUNT + 1);
    });

    it('flush() never throws', async () => {
      store.failAdds = new Error('boom');
      guard.record('writes');
      await expect(guard.flush()).resolves.toBeUndefined();
    });

    it('flush() with nothing pending makes no write', async () => {
      await guard.flush();
      expect(store.adds).toEqual([]);
    });
  });

  describe('day roll-over (UTC)', () => {
    it('starts the new day from the new counter doc', async () => {
      store.setUsed('2026-11-13', { writes: 5_000 });
      expect(await guard.canWrite('writes')).toBe('stop');

      clock = Date.UTC(2026, 10, 14, 0, 0, 0);
      expect(await guard.canWrite('writes')).toBe('ok');
      expect(store.reads.at(-1)?.day).toBe('2026-11-14');
    });

    it('flushes counts to the day they happened on', async () => {
      clock = Date.UTC(2026, 10, 13, 23, 59, 0);
      guard = new QuotaGuard(store, { now: () => clock, logger: silent });
      guard.record('writes', 3);
      clock = Date.UTC(2026, 10, 14, 0, 6, 0);
      guard.record('writes', 2);
      await settle();
      expect(store.adds).toEqual([
        { day: '2026-11-13', delta: { reads: 0, writes: 3, deletes: 0 } },
        { day: '2026-11-14', delta: { reads: 0, writes: 2, deletes: 0 } },
      ]);
    });
  });

  describe('RESOURCE_EXHAUSTED stop flag', () => {
    it('stops every kind until the next midnight Pacific', async () => {
      expect(guard.noteError(EXHAUSTED)).toBe(true);
      const midnight = Date.UTC(2026, 10, 14, 8, 0, 0); // 00:00 PST
      expect(guard.snapshot().stoppedUntil).toBe(midnight);
      for (const kind of ['reads', 'writes', 'deletes'] as const) {
        expect(await guard.canWrite(kind)).toBe('stop');
      }
      await expect(guard.assertCan('writes')).rejects.toBeInstanceOf(QuotaExceededError);
      await expect(guard.assertCan('writes')).rejects.toMatchObject({ reason: 'exhausted' });

      clock = midnight - 1;
      expect(await guard.canWrite('writes')).toBe('stop');
      clock = midnight;
      expect(await guard.canWrite('writes')).toBe('ok');
    });

    it('makes no Firestore call while stopped', async () => {
      guard.noteError(EXHAUSTED);
      guard.record('writes', FLUSH_EVENT_COUNT);
      await guard.canWrite('writes');
      await guard.flush();
      expect(store.reads).toEqual([]);
      expect(store.adds).toEqual([]);
    });

    it('is set by a failed flush or read', async () => {
      store.failAdds = EXHAUSTED;
      guard.record('writes', FLUSH_EVENT_COUNT);
      await settle();
      expect(guard.snapshot().stoppedUntil).not.toBeNull();

      const other = new QuotaGuard(Object.assign(new FakeStore(), { failReads: EXHAUSTED }), { now: () => clock, logger: silent });
      expect(await other.canWrite('writes')).toBe('stop');
    });

    it('ignores other errors', () => {
      expect(guard.noteError(new Error('unavailable'))).toBe(false);
      expect(guard.snapshot().stoppedUntil).toBeNull();
    });
  });
});

describe('quota helpers', () => {
  it('isResourceExhausted recognises the Admin SDK and client SDK shapes', () => {
    expect(isResourceExhausted({ code: 8 })).toBe(true);
    expect(isResourceExhausted({ code: 'resource-exhausted' })).toBe(true);
    expect(isResourceExhausted(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'))).toBe(true);
    expect(isResourceExhausted({ code: 14 })).toBe(false);
    expect(isResourceExhausted(null)).toBe(false);
    expect(isResourceExhausted('RESOURCE_EXHAUSTED')).toBe(false);
  });

  it('nextPacificMidnight handles standard time and both DST switches', () => {
    // PST (UTC-8)
    expect(nextPacificMidnight(Date.UTC(2026, 10, 13, 10))).toBe(Date.UTC(2026, 10, 14, 8));
    // 23:30 PST the night before DST starts (2026-03-08): next midnight is still PST.
    expect(nextPacificMidnight(Date.UTC(2026, 2, 8, 7, 30))).toBe(Date.UTC(2026, 2, 8, 8));
    // After DST starts: next midnight is PDT (UTC-7).
    expect(nextPacificMidnight(Date.UTC(2026, 2, 8, 12))).toBe(Date.UTC(2026, 2, 9, 7));
    // Day DST ends (2026-11-01): midnight on 11-02 is PST again.
    expect(nextPacificMidnight(Date.UTC(2026, 10, 1, 12))).toBe(Date.UTC(2026, 10, 2, 8));
    // Exactly at midnight: the next one, not now.
    expect(nextPacificMidnight(Date.UTC(2026, 10, 14, 8))).toBe(Date.UTC(2026, 10, 15, 8));
  });

  it('utcDay and readsForAggregation', () => {
    expect(utcDay(Date.UTC(2026, 10, 13, 23, 59, 59))).toBe('2026-11-13');
    expect(readsForAggregation(0)).toBe(1);
    expect(readsForAggregation(1_000)).toBe(1);
    expect(readsForAggregation(1_001)).toBe(2);
  });
});
