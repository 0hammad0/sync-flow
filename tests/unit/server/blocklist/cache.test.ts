import { describe, expect, it, vi } from 'vitest';

import { BlocklistCache, BLOCKLIST_TTL_MS, type BlocklistSource } from '@/server/blocklist/cache';
import { emptyBlocklist, type BlocklistSnapshot } from '@/server/blocklist/types';

function fakeSource(snapshot: () => BlocklistSnapshot | Promise<BlocklistSnapshot>) {
  const source = {
    readBlocklist: vi.fn(async () => snapshot()),
    addHits: vi.fn<(hits: ReadonlyMap<string, number>) => Promise<void>>(async () => {}),
  } satisfies BlocklistSource;
  return source;
}

const withIp = (ip: string, version = 1): BlocklistSnapshot => ({
  blocklist: { ...emptyBlocklist(), ips: [{ id: 'b1', value: ip, expiresAt: null }], version },
  settings: { tracking_enabled: true },
});

const silent = { warn: vi.fn() };

describe('BlocklistCache', () => {
  it('reads nothing until the first get() (lazy)', () => {
    const source = fakeSource(() => withIp('1.2.3.4'));
    const getSource = vi.fn(() => source);
    const cache = new BlocklistCache(getSource, { logger: silent });
    expect(getSource).not.toHaveBeenCalled();
    expect(source.readBlocklist).not.toHaveBeenCalled();
    expect(cache.loadCount).toBe(0);
  });

  it('loads once, reuses for 60 s, then refreshes', async () => {
    let now = 1_000_000;
    let version = 1;
    const source = fakeSource(() => withIp('1.2.3.4', version));
    const cache = new BlocklistCache(() => source, { now: () => now, logger: silent });

    expect((await cache.get()).version).toBe(1);
    version = 2;
    now += BLOCKLIST_TTL_MS - 1;
    expect((await cache.get()).version).toBe(1);
    expect(source.readBlocklist).toHaveBeenCalledTimes(1);

    now += 1;
    expect((await cache.get()).version).toBe(2);
    expect(source.readBlocklist).toHaveBeenCalledTimes(2);
    expect(cache.settings()).toEqual({ tracking_enabled: true });
  });

  it('parallel gets share one load', async () => {
    const source = fakeSource(() => withIp('1.2.3.4'));
    const cache = new BlocklistCache(() => source, { logger: silent });
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(source.readBlocklist).toHaveBeenCalledTimes(1);
  });

  it('serves the stale list when a refresh fails, and retries later', async () => {
    let now = 0;
    let fail = false;
    const source = fakeSource(() => {
      if (fail) throw new Error('firestore down');
      return withIp('1.2.3.4', 7);
    });
    const cache = new BlocklistCache(() => source, { now: () => now, retryMs: 10_000, logger: silent });
    await cache.get();
    fail = true;
    now += BLOCKLIST_TTL_MS;
    const stale = await cache.get();
    expect(stale.version).toBe(7);
    expect(stale.match({ ip: '1.2.3.4', uid: null, country: null, device: null }, now)).not.toBeNull();

    // Within the retry window: no new read.
    now += 5_000;
    await cache.get();
    expect(source.readBlocklist).toHaveBeenCalledTimes(2);
    now += 5_000;
    await cache.get();
    expect(source.readBlocklist).toHaveBeenCalledTimes(3);
  });

  it('fails open with an empty list on a cold instance', async () => {
    const source = fakeSource(() => Promise.reject(new Error('down')));
    const cache = new BlocklistCache(() => source, { logger: silent });
    const list = await cache.get();
    expect(list.isEmpty).toBe(true);
  });

  it('flushes counted hits on the next refresh', async () => {
    let now = 0;
    const source = fakeSource(() => withIp('1.2.3.4'));
    const cache = new BlocklistCache(() => source, { now: () => now, logger: silent });
    await cache.get();
    cache.recordHit('b1');
    cache.recordHit('b1');
    expect(source.addHits).not.toHaveBeenCalled();
    now += BLOCKLIST_TTL_MS;
    await cache.get();
    expect(source.addHits).toHaveBeenCalledWith(new Map([['b1', 2]]));
  });
});
