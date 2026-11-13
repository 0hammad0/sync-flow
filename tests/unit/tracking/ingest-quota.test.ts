import { describe, expect, it } from 'vitest';

import { QuotaGuard, type QuotaStore } from '@/server/quota/quota-guard';

import { SID_EVEN, SID_ODD, T0, beacon, engage, ingestHarness, pv, requestMeta } from '../../support/tracking';

describe('IngestService + QuotaGuard decisions', () => {
  it('asks QuotaGuard before the write', async () => {
    const h = ingestHarness();
    await h.service.ingest(beacon([pv('p1', '/')]), requestMeta());
    expect(h.quota.asked).toEqual(['writes']);
    await h.service.ingest(beacon([pv('p2', '/')], { seq: 1, final: true }), requestMeta());
    expect(h.quota.asked).toEqual(['writes', 'writes', 'reads']);
  });

  it('sample (≥ 70%): keeps 1 in 2 new sessions by id, marks them sampled, counts them ×2 in the rollup', async () => {
    const h = ingestHarness();
    h.quota.decisions.writes = 'sample';
    expect(await h.service.ingest(beacon([pv('p1', '/')], { sid: SID_ODD }), requestMeta())).toBe('sampled_out');
    expect(await h.service.ingest(beacon([pv('p1', '/')], { sid: SID_EVEN, final: true }), requestMeta())).toBe('rolled_up');
    expect(h.repo.sessions.has(SID_ODD)).toBe(false);
    expect(h.repo.sessions.get(SID_EVEN)?.sampled).toBe(true);
    expect(h.repo.hourly.get('2026-11-13-10')).toMatchObject({ sessions: 2, views: 2, bounces: 2, sampled: true });

    // Later flushes of the sampled-out session stay out.
    expect(await h.service.ingest(beacon([engage('p1', 1)], { sid: SID_ODD, seq: 1 }), requestMeta())).toBe('sampled_out');
    expect(h.repo.sessions.has(SID_ODD)).toBe(false);

    h.clock.now += 5 * 60_000;
    await h.service.ingest(beacon([engage('p1', 1)], { sid: SID_EVEN, seq: 2 }), requestMeta());
    expect(h.repo.counters.get('2026-11-13')?.ingest).toMatchObject({ sampled_out: 2 });
  });

  it('stop (100%): writes nothing, still returns normally (the route answers 204)', async () => {
    const h = ingestHarness();
    h.quota.decisions.writes = 'stop';
    expect(await h.service.ingest(beacon([pv('p1', '/')], { final: true }), requestMeta())).toBe('stopped');
    expect(h.repo.sessionWrites()).toBe(0);
    expect(h.repo.hourly.size).toBe(0);
  });

  it('read cap: the final flush still writes the session but leaves the rollup to the cron', async () => {
    const h = ingestHarness();
    await h.service.ingest(beacon([pv('p1', '/')]), requestMeta());
    h.quota.decisions.reads = 'stop';
    expect(await h.service.ingest(beacon([engage('p1', 1)], { seq: 1, final: true }), requestMeta())).toBe('written');
    expect(h.repo.hourly.size).toBe(0);
    expect(h.repo.sessions.get(SID_EVEN)?.rolled_up).toBe(false);
  });

  it('with the real QuotaGuard: RESOURCE_EXHAUSTED sets the stop flag and later flushes write nothing', async () => {
    const store: QuotaStore = {
      read: async () => ({ used: { reads: 0, writes: 0, deletes: 0 }, caps: null }),
      add: async () => {},
    };
    const clock = { now: T0 };
    const quota = new QuotaGuard(store, { now: () => clock.now, logger: { warn: () => {} } });
    const h = ingestHarness({ quota, now: () => clock.now });
    const realWrite = h.repo.writeSession.bind(h.repo);
    h.repo.writeSession = async () => {
      const error = Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), { code: 8 });
      quota.noteError(error);
      throw error;
    };
    expect(await h.service.ingest(beacon([pv('p1', '/')]), requestMeta())).toBe('error');
    h.repo.writeSession = realWrite;
    expect(await h.service.ingest(beacon([pv('p2', '/')], { seq: 1 }), requestMeta())).toBe('stopped');
    expect(h.repo.sessionWrites()).toBe(0);
  });

  it('with the real QuotaGuard: 70% of the write cap samples, 100% stops', async () => {
    let used = 3_500;
    const store: QuotaStore = {
      read: async () => ({ used: { reads: 0, writes: used, deletes: 0 }, caps: null }),
      add: async () => {},
    };
    const clock = { now: T0 };
    const quota = new QuotaGuard(store, { now: () => clock.now, logger: { warn: () => {} } });
    const h = ingestHarness({ quota, now: () => clock.now });
    expect(await h.service.ingest(beacon([pv('p1', '/')], { sid: SID_ODD }), requestMeta())).toBe('sampled_out');
    expect(await h.service.ingest(beacon([pv('p1', '/')], { sid: SID_EVEN }), requestMeta())).toBe('written');

    used = 5_000;
    clock.now += 61_000;
    expect(await h.service.ingest(beacon([engage('p1', 1)], { sid: SID_EVEN, seq: 1 }), requestMeta())).toBe('stopped');
    expect(h.repo.sessionWrites()).toBe(1);
  });
});
