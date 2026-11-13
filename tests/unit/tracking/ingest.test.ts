import { describe, expect, it } from 'vitest';

import { clampTs, keptWhenSampling } from '@/features/tracking/server/ingest';
import { encodeKey } from '@/server/firestore/encode-key';

import {
  SID_EVEN,
  T0,
  beacon,
  engage,
  ingestHarness,
  pv,
  requestMeta,
} from '../../support/tracking';

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

describe('IngestService: drops before any write', () => {
  it('kill switch: tracking off (default, no settings doc) writes nothing, not even counters', async () => {
    const h = ingestHarness();
    h.repo.settings = null;
    expect(await h.service.ingest(beacon([pv('p1', '/')]), requestMeta())).toBe('disabled');
    await h.service.counters.flush();
    expect(h.repo.writes).toEqual([]);
    expect(h.quota.asked).toEqual([]);
  });

  it('reads the settings at most once per 60 s', async () => {
    const h = ingestHarness();
    await h.service.ingest(beacon([pv('p1', '/')]), requestMeta());
    await h.service.ingest(beacon([pv('p2', '/')], { seq: 1 }), requestMeta());
    expect(h.repo.reads).toBe(1);
    h.clock.now += 60_000;
    await h.service.ingest(beacon([pv('p3', '/')], { seq: 2 }), requestMeta());
    expect(h.repo.reads).toBe(2);
  });

  it('a failing settings read counts as tracking off', async () => {
    const h = ingestHarness();
    h.repo.readTrackingSettings = async () => {
      throw new Error('boom');
    };
    expect(await h.service.ingest(beacon([pv('p1', '/')]), requestMeta())).toBe('disabled');
    expect(h.repo.writes).toEqual([]);
  });

  it('drops a bot before any write or blocklist / quota check', async () => {
    const h = ingestHarness();
    let blockChecks = 0;
    const service = ingestHarness({ findBlock: async () => (blockChecks++, null) });
    service.repo.settings = { trackingEnabled: true };
    expect(await service.service.ingest(beacon([pv('p1', '/')]), requestMeta({ userAgent: GOOGLEBOT }))).toBe('bot');
    expect(await h.service.ingest(beacon([pv('p1', '/')]), requestMeta({ userAgent: null }))).toBe('bot');
    expect(service.repo.sessionWrites()).toBe(0);
    expect(h.repo.sessionWrites()).toBe(0);
    expect(blockChecks).toBe(0);
    expect(service.quota.asked).toEqual([]);
  });

  it('drops a blocked subject before any write, and passes ip, uid, country and device hash to the blocklist', async () => {
    const seen: unknown[] = [];
    const h = ingestHarness({ findBlock: async (s) => (seen.push(s), { blockId: 'b1', ref: 'ip' }) });
    const out = await h.service.ingest(
      beacon([pv('p1', '/')], { did: 'dev-1' }),
      requestMeta({ sessionCookie: 'valid' }),
    );
    expect(out).toBe('blocked');
    expect(h.repo.sessionWrites()).toBe(0);
    expect(h.quota.asked).toEqual([]);
    expect(seen).toEqual([{ ip: '203.0.113.7', uid: 'uid-1', country: 'PK', device: 'hash-dev-1' }]);
  });

  it('never throws: a write error is logged with an id and counted', async () => {
    const h = ingestHarness();
    h.repo.writeSession = async () => {
      throw new Error('firestore down');
    };
    expect(await h.service.ingest(beacon([pv('p1', '/')]), requestMeta())).toBe('error');
    expect(String(h.logs[0][0])).toMatch(/^\[ingest\] error [0-9a-f]{8}$/);
    await h.service.counters.flush();
    expect(h.repo.counters.get('2026-11-13')?.ingest).toMatchObject({ error: 1 });
  });
});

describe('IngestService: one write per flush', () => {
  it('a new session: one set/merge with start fields, geo, UA and the first page', async () => {
    const h = ingestHarness();
    const out = await h.service.ingest(
      beacon(
        [
          pv('p1', '/chat/[code]', T0 - 5_000, { ref: 'https://news.example.com/a', utm_source: 'news', utm_campaign: 'launch' } as never),
          engage('p1', 4_000, 50),
        ],
        { did: 'dev-1' },
      ),
      requestMeta({ sessionCookie: 'valid' }),
    );
    expect(out).toBe('written');
    expect(h.repo.writes).toEqual([{ method: 'writeSession', id: SID_EVEN }]);
    const s = h.repo.sessions.get(SID_EVEN);
    expect(s).toMatchObject({
      ip: '203.0.113.7',
      ip_trunc: '203.0.113.0',
      ip_held: true,
      ip_hash: null,
      country: 'PK',
      city: 'Lahore',
      lat: 31.55,
      lon: 74.34,
      device: 'mobile',
      os: 'iOS',
      entry_path: '/chat/[code]',
      exit_path: '/chat/[code]',
      referrer_host: 'news.example.com',
      utm_source: 'news',
      utm_medium: null,
      utm_campaign: 'launch',
      viewport_w: 390,
      pageviews: 1,
      engaged_ms: 4_000,
      user_id: 'uid-1',
      device_hash: 'hash-dev-1',
      rolled_up: false,
      sampled: false,
    });
    expect(s?.started_at?.getTime()).toBe(T0);
    expect(s?.pages.p1).toEqual({ path: '/chat/[code]', ts: new Date(T0 - 5_000), engaged_ms: 4_000, scroll_max: 50 });
  });

  it('a later checkpoint adds engaged time to an earlier page without overwriting start fields', async () => {
    const h = ingestHarness();
    await h.service.ingest(beacon([pv('p1', '/', T0, { ref: 'https://a.example' } as never)]), requestMeta());
    h.clock.now += 60_000;
    await h.service.ingest(
      beacon([engage('p1', 30_000, 75), pv('p2', '/send', T0 + 50_000, { ref: 'https://b.example' } as never)], { seq: 1 }),
      requestMeta(),
    );
    expect(h.repo.sessionWrites()).toBe(2);
    const s = h.repo.sessions.get(SID_EVEN);
    expect(s?.started_at?.getTime()).toBe(T0);
    expect(s).toMatchObject({ entry_path: '/', exit_path: '/send', referrer_host: 'a.example', pageviews: 2, engaged_ms: 30_000 });
    expect(s?.pages.p1).toMatchObject({ path: '/', engaged_ms: 30_000, scroll_max: 75 });
    expect(s?.last_seen_at.getTime()).toBe(T0 + 60_000);
  });

  it('a self-referral is not a source', async () => {
    const h = ingestHarness();
    await h.service.ingest(beacon([pv('p1', '/', T0, { ref: 'https://syncflow.example/chat' } as never)]), requestMeta());
    expect(h.repo.sessions.get(SID_EVEN)?.referrer_host).toBeNull();
  });

  it('stores vitals on the session with the flush (no extra write)', async () => {
    const h = ingestHarness();
    await h.service.ingest(
      beacon([pv('p1', '/'), { type: 'vitals', t: T0, lcp: 1800, inp: 90, cls: 0.01 }]),
      requestMeta(),
    );
    expect(h.repo.sessionWrites()).toBe(1);
    expect(h.repo.sessions.get(SID_EVEN)?.vitals).toEqual({ lcp: 1800, inp: 90, cls: 0.01 });
  });

  it('mode B (light) stores a daily-salted hash and never the IP', async () => {
    const h = ingestHarness({ mode: 'light', hashSecret: 'secret' });
    await h.service.ingest(beacon([pv('p1', '/')]), requestMeta());
    const s = h.repo.sessions.get(SID_EVEN);
    expect(s).toMatchObject({ ip: null, ip_trunc: null, ip_held: false });
    expect(s?.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(s)).not.toContain('203.0.113');
  });

  it('stores no query strings, room codes or tokens anywhere', async () => {
    const h = ingestHarness();
    await h.service.ingest(
      beacon([pv('p1', '/chat/[code]'), pv('p2', '/share/[token]', T0 + 1), pv('p3', '/send/[token]', T0 + 2)], { final: true }),
      requestMeta(),
    );
    const everything = JSON.stringify([...h.repo.sessions.values(), ...h.repo.hourly.values()]);
    expect(everything).not.toMatch(/\?|AB12CD/);
  });
});

describe('IngestService: rollup only on the final flush', () => {
  it('checkpoints never touch a_hourly', async () => {
    const h = ingestHarness();
    await h.service.ingest(beacon([pv('p1', '/')]), requestMeta());
    await h.service.ingest(beacon([engage('p1', 1_000)], { seq: 1 }), requestMeta());
    expect(h.repo.hourly.size).toBe(0);
    expect(h.repo.sessions.get(SID_EVEN)?.rolled_up).toBe(false);
  });

  it('the final flush reads the session once and adds the whole session to a_hourly in the same write', async () => {
    const h = ingestHarness();
    await h.service.ingest(beacon([pv('p1', '/', T0), engage('p1', 2_000, 25)]), requestMeta());
    h.clock.now += 50_000;
    const readsBefore = h.repo.reads;
    const out = await h.service.ingest(
      beacon([engage('p1', 1_000, 50), pv('p2', '/chat/[code]', T0 + 90_000), engage('p2', 5_000, 100)], { seq: 1, final: true }),
      requestMeta(),
    );
    expect(out).toBe('rolled_up');
    expect(h.repo.reads - readsBefore).toBe(1);
    expect(h.repo.sessionWrites()).toBe(2);
    expect(h.repo.sessions.get(SID_EVEN)?.rolled_up).toBe(true);

    const hour = h.repo.hourly.get('2026-11-13-10');
    expect(hour).toMatchObject({ sessions: 1, views: 2, bounces: 0, engaged_ms: 8_000, sampled: false });
    expect(hour?.path[encodeKey('/')]).toMatchObject({ views: 1, entries: 1, exits: 0, engaged_ms: 3_000, scroll_sum: 50 });
    expect(hour?.path[encodeKey('/chat/[code]')]).toMatchObject({ views: 1, entries: 0, exits: 1, scroll_sum: 100 });
    expect(hour?.country.PK).toMatchObject({ sessions: 1, views: 2 });
    expect(hour?.device.mobile).toMatchObject({ sessions: 1 });
    expect(hour?.city[encodeKey('PK:PB:Lahore')]).toMatchObject({ sessions: 1, lat: 31.55, lon: 74.34 });
  });

  it('a second final flush does not count the session twice', async () => {
    const h = ingestHarness();
    await h.service.ingest(beacon([pv('p1', '/')]), requestMeta());
    await h.service.ingest(beacon([engage('p1', 1)], { seq: 1, final: true }), requestMeta());
    expect(await h.service.ingest(beacon([engage('p1', 1)], { seq: 2, final: true }), requestMeta())).toBe('written');
    expect(h.repo.hourly.get('2026-11-13-10')?.sessions).toBe(1);
  });

  it('a one-flush session (seq 0, final) is rolled up at once', async () => {
    const h = ingestHarness();
    expect(await h.service.ingest(beacon([pv('p1', '/')], { final: true }), requestMeta())).toBe('rolled_up');
    expect(h.repo.hourly.get('2026-11-13-10')).toMatchObject({ sessions: 1, bounces: 1 });
  });

  it('a final flush that overtook the first one leaves the rollup to the nightly catch-up', async () => {
    const h = ingestHarness();
    expect(await h.service.ingest(beacon([engage('p1', 500)], { seq: 1, final: true }), requestMeta())).toBe('written');
    expect(h.repo.hourly.size).toBe(0);
    expect(h.repo.sessions.get(SID_EVEN)?.rolled_up).toBe(false);
    // The late first flush keeps it pending, not double counted.
    await h.service.ingest(beacon([pv('p1', '/')]), requestMeta());
    expect(h.repo.sessions.get(SID_EVEN)?.rolled_up).toBe(false);
    expect(h.repo.hourly.size).toBe(0);
  });
});

describe('IngestService: counters', () => {
  it('counts accepted, dropped (invalid, bot, blocked) and buffers them into one write', async () => {
    const h = ingestHarness();
    await h.service.ingest(beacon([pv('p1', '/'), engage('p1', 1)], { invalid: 2 }), requestMeta());
    await h.service.ingest(beacon([pv('p1', '/')]), requestMeta({ userAgent: GOOGLEBOT }));
    h.blocked.value = true;
    await h.service.ingest(beacon([pv('p1', '/')]), requestMeta());
    expect(h.repo.writes.filter((w) => w.method === 'incrementCounters')).toHaveLength(0);

    h.clock.now += 5 * 60_000;
    h.blocked.value = false;
    await h.service.ingest(beacon([engage('p1', 1)], { seq: 1 }), requestMeta());
    expect(h.repo.writes.filter((w) => w.method === 'incrementCounters')).toHaveLength(1);
    expect(h.repo.counters.get('2026-11-13')?.ingest).toEqual({ accepted: 3, dropped: 4 });
  });
});

describe('helpers', () => {
  it('clamps client time to the last 24 h, never the future', () => {
    const now = new Date(T0);
    expect(clampTs(T0 + 60_000, now).getTime()).toBe(T0);
    expect(clampTs(0, now).getTime()).toBe(T0 - 86_400_000);
    expect(clampTs(T0 - 1_000, now).getTime()).toBe(T0 - 1_000);
  });

  it('samples by session id, about 1 in 2', () => {
    const kept = Array.from({ length: 16 }, (_, i) => keptWhenSampling(`${'0'.repeat(31)}${i.toString(16)}`));
    expect(kept.filter(Boolean)).toHaveLength(8);
  });
});
