import { describe, expect, it } from 'vitest';

import { BATCH, RollupService, type CronRun } from '@/features/tracking/server/rollup';
import {
  emptyRollup,
  foldRollup,
  sessionRollup,
  type SessionPatch,
} from '@/server/analytics/model';
import { FOLD_KEY, encodeKey } from '@/server/firestore/encode-key';

import { MemoryEventRepository } from '../../support/memory-event-repository';
import { FakeQuota } from '../../support/tracking';

const NOW = Date.parse('2026-11-14T04:10:00.000Z');
const MIN = 60_000;
const DAY = 86_400_000;

function patch(id: string, at: number, overrides: Partial<SessionPatch['set']> = {}, paths = ['/']): SessionPatch {
  const pages: SessionPatch['pages'] = {};
  paths.forEach((path, i) => (pages[`p${i}`] = { path, ts: new Date(at + i * 1000), engaged_ms: 1000, scroll_max: 50 }));
  return {
    id,
    now: new Date(at),
    set: { started_at: new Date(at), rolled_up: false, sampled: false, ip: '203.0.113.7', ip_held: true, country: 'PK', device: 'desktop', ...overrides },
    increment: { pageviews: paths.length, engaged_ms: 1000 * paths.length },
    pages,
  };
}

function harness(budgetMs?: number) {
  const repo = new MemoryEventRepository();
  const quota = new FakeQuota();
  const runs: CronRun[] = [];
  const clock = { now: NOW };
  const service = new RollupService({
    events: repo,
    quota,
    recordCronRun: async (run) => {
      runs.push(run);
    },
    now: () => clock.now,
    budgetMs,
    logger: { error: () => {} },
  });
  return { repo, quota, runs, clock, service };
}

const sid = (n: number) => n.toString(16).padStart(32, '0');

describe('rollup step 1: catch-up', () => {
  it('rolls up sessions with rolled_up == false last seen over 30 min ago, and only those', async () => {
    const h = harness();
    await h.repo.writeSession(patch(sid(1), NOW - 3 * 3_600_000, {}, ['/', '/chat/[code]']));
    await h.repo.writeSession(patch(sid(2), NOW - 10 * MIN));
    await h.repo.writeSession(patch(sid(3), NOW - 2 * 3_600_000, { rolled_up: true }));

    const result = await h.service.run();
    expect(result.counts.sessions_rolled_up).toBe(1);
    expect(h.repo.sessions.get(sid(1))?.rolled_up).toBe(true);
    expect(h.repo.sessions.get(sid(2))?.rolled_up).toBe(false);
    expect(h.repo.hourly.get('2026-11-14-01')).toMatchObject({ sessions: 1, views: 2, bounces: 0 });
  });

  it('counts a sampled session twice', async () => {
    const h = harness();
    await h.repo.writeSession(patch(sid(1), NOW - 3 * 3_600_000, { sampled: true }));
    await h.service.run();
    expect(h.repo.hourly.get('2026-11-14-01')).toMatchObject({ sessions: 2, views: 2, bounces: 2, sampled: true });
  });
});

describe('rollup step 2: a_daily', () => {
  it('builds the last 2 UTC days from a_hourly by overwrite (idempotent), with the sampled flag', async () => {
    const h = harness();
    const d1 = Date.parse('2026-11-13T00:00:00Z');
    const d2 = Date.parse('2026-11-12T00:00:00Z');
    await h.repo.writeSession(patch(sid(1), d1 + 3_600_000, { rolled_up: true }), {
      hour: '2026-11-13-01',
      delta: sessionRollup({ ...(await seed(patch(sid(1), d1 + 3_600_000))) }),
    });
    await h.repo.writeSession(patch(sid(2), d1 + 5 * 3_600_000, { rolled_up: true }), {
      hour: '2026-11-13-05',
      delta: sessionRollup(await seed(patch(sid(2), d1 + 5 * 3_600_000, { sampled: true }))),
    });
    await h.repo.writeSession(patch(sid(3), d2 + 3_600_000, { rolled_up: true }), {
      hour: '2026-11-12-01',
      delta: sessionRollup(await seed(patch(sid(3), d2 + 3_600_000))),
    });

    const first = await h.service.run();
    expect(first.counts.daily_built).toBe(2);
    const day = await h.repo.getDaily('2026-11-13');
    expect(day).toMatchObject({ day: '2026-11-13', sessions: 3, views: 3, sampled: true });
    expect(day?.path[encodeKey('/')]).toMatchObject({ views: 3, entries: 3 });
    expect((await h.repo.getDaily('2026-11-12'))?.sampled).toBe(false);

    await h.service.run();
    expect((await h.repo.getDaily('2026-11-13'))?.sessions).toBe(3);
    // Today (partial) and older days are not built.
    expect(await h.repo.getDaily('2026-11-14')).toBeNull();
    expect(await h.repo.getDaily('2026-11-11')).toBeNull();
  });

  it('skips a day with no hourly docs (never overwrites a daily whose hours are gone)', async () => {
    const h = harness();
    await h.repo.putDaily({ ...emptyRollup(), sessions: 7, day: '2026-11-12', built_at: new Date(0) });
    await h.service.run();
    expect((await h.repo.getDaily('2026-11-12'))?.sessions).toBe(7);
  });

  it('backfills any day whose hourly docs still exist', async () => {
    const h = harness();
    const r = emptyRollup();
    r.sessions = 4;
    h.repo.hourly.set('2026-11-05-09', r);
    expect(await h.service.buildDaily('2026-11-05')).toBe(true);
    expect((await h.repo.getDaily('2026-11-05'))?.sessions).toBe(4);
  });

  it('folds map keys beyond the cap into _other', () => {
    const r = emptyRollup();
    for (let i = 0; i < 5; i++) r.referrer[`h${i}`] = { sessions: 10 - i, views: 1, engaged_ms: 1, bounces: 0 };
    r.city.c1 = { sessions: 1, views: 1, engaged_ms: 1, bounces: 0, lat: 1, lon: 1 };
    const folded = foldRollup(r, 3);
    expect(Object.keys(folded.referrer).sort()).toEqual([FOLD_KEY, 'h0', 'h1'].sort());
    expect(folded.referrer[FOLD_KEY]).toEqual({ sessions: 8 + 7 + 6, views: 3, engaged_ms: 3, bounces: 0 });
    expect(folded.city).toEqual(r.city);
  });
});

describe('rollup step 3: retention', () => {
  it('nulls IPs after 30 days and deletes sessions after 90, hourly after 14 days, counters after a year', async () => {
    const h = harness();
    await h.repo.writeSession(patch(sid(1), NOW - 31 * DAY, { rolled_up: true }));
    await h.repo.writeSession(patch(sid(2), NOW - 29 * DAY, { rolled_up: true }));
    await h.repo.writeSession(patch(sid(3), NOW - 91 * DAY, { rolled_up: true }));
    h.repo.hourly.set('2026-10-30-03', emptyRollup());
    h.repo.hourly.set('2026-10-31-05', emptyRollup());
    h.repo.counters.set('2025-11-13', { ingest: { accepted: 1 } });
    h.repo.counters.set('2025-11-15', { ingest: { accepted: 1 } });

    const result = await h.service.run();
    expect(result.status).toBe('ok');
    expect(result.counts).toMatchObject({ ips_nulled: 1, sessions_deleted: 1, hourly_deleted: 1, counters_deleted: 1, stopped_at_cap: 0 });
    expect(h.repo.sessions.get(sid(1))).toMatchObject({ ip: null, ip_held: false });
    expect(h.repo.sessions.get(sid(2))?.ip).toBe('203.0.113.7');
    expect(h.repo.sessions.has(sid(3))).toBe(false);
    expect([...h.repo.hourly.keys()]).toEqual(['2026-10-31-05']);
    expect([...h.repo.counters.keys()]).toEqual(['2025-11-15']);
  });

  it('uses the retention windows from settings', async () => {
    const h = harness();
    h.repo.settings = { ipRetentionDays: 7, rawRetentionDays: 20 };
    await h.repo.writeSession(patch(sid(1), NOW - 8 * DAY, { rolled_up: true }));
    await h.repo.writeSession(patch(sid(2), NOW - 21 * DAY, { rolled_up: true }));
    await h.service.run();
    expect(h.repo.sessions.get(sid(1))?.ip).toBeNull();
    expect(h.repo.sessions.has(sid(2))).toBe(false);
  });

  it('deletes in batches of 500 until done', async () => {
    const h = harness();
    for (let i = 0; i < BATCH + 20; i++) await h.repo.writeSession(patch(sid(i + 1), NOW - 100 * DAY, { rolled_up: true }));
    const result = await h.service.run();
    expect(result.counts.sessions_deleted).toBe(BATCH + 20);
    expect(h.repo.sessions.size).toBe(0);
  });

  it('stops at the delete cap, records "stopped at cap", and continues the next night', async () => {
    const h = harness();
    await h.repo.writeSession(patch(sid(1), NOW - 100 * DAY, { rolled_up: true }));
    h.repo.hourly.set('2026-10-01-00', emptyRollup());
    h.quota.decisions.deletes = 'stop';
    const result = await h.service.run();
    expect(result.status).toBe('partial');
    expect(result.counts.stopped_at_cap).toBe(1);
    expect(h.repo.sessions.size).toBe(1);
    expect(h.repo.deletes).toBe(0);
    // Still nulled the IP (writes have their own cap).
    expect(h.repo.sessions.get(sid(1))?.ip).toBeNull();
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]).toMatchObject({ job: 'rollup', status: 'partial', counts: { stopped_at_cap: 1 } });

    h.quota.decisions.deletes = 'ok';
    const next = await h.service.run();
    expect(next.status).toBe('ok');
    expect(next.counts).toMatchObject({ sessions_deleted: 1, hourly_deleted: 1 });
  });

  it('stops IP nulling and rollups at the write cap', async () => {
    const h = harness();
    await h.repo.writeSession(patch(sid(1), NOW - 31 * DAY));
    h.quota.decisions.writes = 'stop';
    const result = await h.service.run();
    expect(result.counts).toMatchObject({ sessions_rolled_up: 0, ips_nulled: 0, stopped_at_cap: 1 });
    expect(h.repo.sessions.get(sid(1))).toMatchObject({ rolled_up: false, ip: '203.0.113.7' });
  });
});

describe('rollup run record', () => {
  it('records exactly one cron run per run and flushes the quota counts', async () => {
    const h = harness();
    const result = await h.service.run();
    expect(result.status).toBe('ok');
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]).toMatchObject({ job: 'rollup', status: 'ok', error: null });
    expect(h.runs[0].counts).toHaveProperty('stopped_at_cap', 0);
    expect(h.quota.flushed).toBe(1);
  });

  it('a failure is recorded as failed, not thrown', async () => {
    const h = harness();
    h.repo.listUnrolledSessions = async () => {
      throw new Error('boom');
    };
    const result = await h.service.run();
    expect(result).toMatchObject({ status: 'failed', error: 'boom' });
    expect(h.runs[0]).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('a time budget stop is partial', async () => {
    const h = harness(0);
    const result = await h.service.run();
    expect(result.status).toBe('partial');
    expect(result.counts.time_budget_used).toBe(1);
  });
});

async function seed(p: SessionPatch) {
  const repo = new MemoryEventRepository();
  await repo.writeSession(p);
  const s = await repo.getSession(p.id);
  if (!s) throw new Error('seed failed');
  return s;
}
