import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';

import { config, proxy } from '@/proxy';
import { BlocklistCache, setBlocklistCacheForTests } from '@/server/blocklist/cache';
import { emptyBlocklist, type BlocklistData } from '@/server/blocklist/types';

const verifySessionCookie = vi.fn(async (cookie: string) => {
  if (cookie === 'owner') return { uid: 'uid-owner' };
  if (cookie === 'bad-user') return { uid: 'uid-bad' };
  throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
});

vi.mock('@/shared/lib/firebase/admin', () => ({
  adminAuth: () => ({ verifySessionCookie }),
  adminDb: vi.fn(),
}));

const ORIGIN = 'https://sync.test';
const BLOCKED_IP = '203.0.113.7';

let data: BlocklistData;
const readBlocklist = vi.fn(async () => ({ blocklist: structuredClone(data), settings: null }));
const addHits = vi.fn(async () => {});

function req(path: string, init: { method?: string; ip?: string; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': init.ip ?? BLOCKED_IP, ...init.headers };
  if (init.cookie) headers.cookie = `__session=${init.cookie}`;
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? 'GET', headers });
}

const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';

beforeEach(() => {
  data = { ...emptyBlocklist(), ips: [{ id: 'K3F9QXAAAAAAAAAAAAAA', value: BLOCKED_IP, expiresAt: null }], version: 1 };
  readBlocklist.mockClear();
  addHits.mockClear();
  verifySessionCookie.mockClear();
  setBlocklistCacheForTests(new BlocklistCache(() => ({ readBlocklist, addHits }), { logger: { warn: vi.fn() } }));
});

afterEach(() => setBlocklistCacheForTests(null));

describe('proxy: blocked IP [T-27]', () => {
  it('page views pass with no blocklist read (cold instance stays at 0 reads)', async () => {
    for (const path of ['/dashboard', '/login', '/admin', '/admin/access']) {
      const res = await proxy(req(path, { cookie: 'owner' }));
      expect(res.status, path).not.toBe(403);
    }
    expect(readBlocklist).not.toHaveBeenCalled();
  });

  it('/api/** answers 403 JSON { error: "blocked", ref }', async () => {
    const res = await proxy(req('/api/upload/presign', { method: 'POST' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'blocked', ref: expect.stringMatching(/^K3F9QX-\d{10}$/) });
    expect(res.headers.get('x-block-ref')).toBe(body.ref);
    // GET under /api is an action too.
    expect((await proxy(req('/api/chat/ABC123'))).status).toBe(403);
  });

  it('a server action answers 403 text/plain (the Next client throws its body) + x-block-ref', async () => {
    const res = await proxy(req('/share/tok', { method: 'POST', headers: { 'next-action': 'abc123' } }));
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(JSON.parse(await res.text())).toEqual({ error: 'blocked', ref: res.headers.get('x-block-ref') });
  });

  it('a no-JS form post (no next-action) is blocked too', async () => {
    const res = await proxy(
      req('/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
    );
    expect(res.status).toBe(403);
  });

  it('sign-out, cron and the tracker are never blocked', async () => {
    expect(passes(await proxy(req('/api/session', { method: 'DELETE' })))).toBe(true);
    expect(passes(await proxy(req('/api/cleanup', { headers: { authorization: 'Bearer x' } })))).toBe(true);
    expect(passes(await proxy(req('/api/admin/cron/rollup', { method: 'POST' })))).toBe(true);
    expect(passes(await proxy(req('/api/e', { method: 'POST' })))).toBe(true);
    expect(readBlocklist).not.toHaveBeenCalled();
  });

  it('an unblocked visitor passes; the list is read once for many actions', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(passes(await proxy(req('/api/upload', { method: 'POST', ip: '198.51.100.1' })))).toBe(true);
    }
    expect(readBlocklist).toHaveBeenCalledTimes(1);
  });

  it('the owner still opens /admin while their IP is blocked; admin actions are checked', async () => {
    const page = await proxy(req('/admin/access', { cookie: 'owner' }));
    expect(page.status).toBe(200);
    expect(page.headers.get('location')).toBeNull();
    const action = await proxy(req('/admin/access', { method: 'POST', cookie: 'owner', headers: { 'next-action': 'x' } }));
    expect(action.status).toBe(403);
  });

  it('IPv4-mapped IPv6 from the platform still matches', async () => {
    expect((await proxy(req('/api/upload', { method: 'POST', ip: `::ffff:${BLOCKED_IP}` }))).status).toBe(403);
  });

  it('country blocks use x-vercel-ip-country', async () => {
    data = { ...emptyBlocklist(), countries: [{ id: 'CTRYBLOCKAAAAAAAAAAA', value: 'KP', expiresAt: null }], version: 1 };
    const blocked = await proxy(req('/api/send', { method: 'POST', ip: '198.51.100.1', headers: { 'x-vercel-ip-country': 'kp' } }));
    expect(blocked.status).toBe(403);
  });

  it('verifies the session cookie only when a uid block exists', async () => {
    await proxy(req('/api/upload', { method: 'POST', ip: '198.51.100.1', cookie: 'bad-user' }));
    expect(verifySessionCookie).not.toHaveBeenCalled();

    data = { ...emptyBlocklist(), uids: [{ id: 'UIDBLOCKAAAAAAAAAAAA', value: 'uid-bad', expiresAt: null }], version: 2 };
    setBlocklistCacheForTests(new BlocklistCache(() => ({ readBlocklist, addHits }), { logger: { warn: vi.fn() } }));
    const res = await proxy(req('/api/upload', { method: 'POST', ip: '198.51.100.1', cookie: 'bad-user' }));
    expect(res.status).toBe(403);
    expect(verifySessionCookie).toHaveBeenCalledWith('bad-user', false);
  });

  it('expired blocks stop at once, before the cron removes them', async () => {
    data = { ...emptyBlocklist(), ips: [{ id: 'EXPIREDAAAAAAAAAAAAA', value: BLOCKED_IP, expiresAt: Date.now() - 1 }], version: 1 };
    expect(passes(await proxy(req('/api/upload', { method: 'POST' })))).toBe(true);
  });
});

describe('proxy matcher: page views never invoke the proxy', () => {
  it.each(['/', '/chat', '/chat/ABC123', '/share/t', '/send', '/receive', '/privacy', '/blocked', '/administrator'])(
    'skips a GET of %s',
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );

  it.each(['/api/upload', '/api/chat/ABC/messages', '/api/session', '/api/admin/files', '/api/events', '/api/e2'])('runs on %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each(['/api/e', '/api/e/batch', '/api/cleanup', '/api/admin/cron', '/api/admin/cron/rollup'])(
    'skips never-blocked %s',
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );

  it('runs on server actions to any page (JS and no-JS)', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: '/share/t', headers: { 'next-action': 'abc' } })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, url: '/', headers: { 'next-action': 'abc' } })).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({ config, url: '/', headers: { 'content-type': 'multipart/form-data; boundary=x' } }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({ config, url: '/x', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
    ).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, url: '/x', headers: { 'content-type': 'application/json' } })).toBe(false);
  });
});
