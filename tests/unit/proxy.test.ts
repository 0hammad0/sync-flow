import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server';
import { config, proxy } from '@/proxy';
import { BlocklistCache, setBlocklistCacheForTests } from '@/server/blocklist/cache';
import { emptyBlocklist } from '@/server/blocklist/types';
import { isProtectedAdminPath } from '@/shared/lib/firebase/proxy';
import nextConfig from '../../next.config';

const verifySessionCookie = vi.fn(async (cookie: string) => {
  if (cookie === 'valid') return { uid: 'u1' };
  throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
});

vi.mock('@/shared/lib/firebase/admin', () => ({
  adminAuth: () => ({ verifySessionCookie }),
  adminDb: vi.fn(),
}));

const ORIGIN = 'https://sync.test';

// Action requests (/api/**) now run a blocklist check: give them an empty list.
setBlocklistCacheForTests(
  new BlocklistCache(() => ({
    readBlocklist: async () => ({ blocklist: emptyBlocklist(), settings: null }),
    addHits: async () => {},
  })),
);

function request(path: string, cookie?: string) {
  return new NextRequest(`${ORIGIN}${path}`, {
    headers: cookie ? { cookie: `__session=${cookie}` } : {},
  });
}

function location(res: Response): string | null {
  return res.headers.get('location');
}

describe('proxy: /admin', () => {
  it('signed out on /admin → /admin/sign-in?next=/admin', async () => {
    const res = await proxy(request('/admin'));
    expect(res.status).toBe(307);
    expect(location(res)).toBe(`${ORIGIN}/admin/sign-in?next=%2Fadmin`);
  });

  it('deep link keeps path and query in next', async () => {
    const res = await proxy(request('/admin/files?type=chat'));
    expect(location(res)).toBe(`${ORIGIN}/admin/sign-in?next=%2Fadmin%2Ffiles%3Ftype%3Dchat`);
  });

  it('dead cookie → redirect and the cookie is cleared', async () => {
    const res = await proxy(request('/admin/rooms', 'expired'));
    expect(location(res)).toBe(`${ORIGIN}/admin/sign-in?next=%2Fadmin%2Frooms`);
    expect(res.headers.get('set-cookie')).toMatch(/__session=;.*Max-Age=0/i);
  });

  it('valid cookie → passes through (no role check in the proxy)', async () => {
    const res = await proxy(request('/admin/settings', 'valid'));
    expect(location(res)).toBeNull();
    expect(verifySessionCookie).toHaveBeenCalledWith('valid', false);
  });

  it('/admin/sign-in is never redirected and skips the cookie verify', async () => {
    verifySessionCookie.mockClear();
    for (const cookie of [undefined, 'expired', 'valid']) {
      const res = await proxy(request('/admin/sign-in?next=%2Fadmin', cookie));
      expect(location(res)).toBeNull();
    }
    expect(verifySessionCookie).not.toHaveBeenCalled();
  });

  it('/api/admin/** is never redirected (the proxy only runs its blocklist check there)', async () => {
    const res = await proxy(request('/api/admin/files'));
    expect(location(res)).toBeNull();
  });

  it('an over-long next is dropped, not passed through', async () => {
    const res = await proxy(request(`/admin/files?q=${'a'.repeat(600)}`));
    expect(location(res)).toBe(`${ORIGIN}/admin/sign-in`);
  });

  it('isProtectedAdminPath', () => {
    expect(isProtectedAdminPath('/admin')).toBe(true);
    expect(isProtectedAdminPath('/admin/files/s_1')).toBe(true);
    expect(isProtectedAdminPath('/admin/sign-in')).toBe(false);
    expect(isProtectedAdminPath('/administrator')).toBe(false);
    expect(isProtectedAdminPath('/api/admin/x')).toBe(false);
  });
});

describe('proxy: existing /dashboard and /login behaviour', () => {
  it('signed out on /dashboard → /login?next=/dashboard', async () => {
    const res = await proxy(request('/dashboard'));
    expect(location(res)).toBe(`${ORIGIN}/login?next=%2Fdashboard`);
  });

  it('signed out on /dashboard with a query keeps it in next', async () => {
    const res = await proxy(request('/dashboard?tab=files'));
    expect(location(res)).toBe(`${ORIGIN}/login?next=%2Fdashboard%3Ftab%3Dfiles`);
  });

  it('signed in on /dashboard passes through', async () => {
    const res = await proxy(request('/dashboard', 'valid'));
    expect(location(res)).toBeNull();
  });

  it('signed in on /login → /dashboard', async () => {
    const res = await proxy(request('/login', 'valid'));
    expect(location(res)).toBe(`${ORIGIN}/dashboard`);
  });

  it('signed in on /login?next=/send → /send', async () => {
    const res = await proxy(request('/login?next=%2Fsend', 'valid'));
    expect(location(res)).toBe(`${ORIGIN}/send`);
  });

  it('signed out on /login passes through', async () => {
    const res = await proxy(request('/login'));
    expect(location(res)).toBeNull();
  });
});

describe('proxy matcher is tight', () => {
  it.each(['/admin', '/admin/files', '/admin/sign-in', '/dashboard', '/dashboard/x', '/login'])(
    'runs on %s',
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    },
  );

  // /api/** and server actions are matched for blocklist checks: tests/unit/proxy-blocklist.test.ts.
  it.each(['/', '/chat', '/chat/ABC123', '/share/t', '/send', '/receive', '/privacy', '/administrator'])(
    'skips %s',
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );
});

describe('next.config headers for admin', () => {
  const expected = {
    'x-robots-tag': 'noindex, nofollow',
    'cache-control': 'private, no-store',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
  };

  it.each(['/admin', '/admin/files', '/admin/sign-in', '/api/admin/export/audit'])('sets them on %s', async (path) => {
    const res = await unstable_getResponseFromNextConfig({ url: `${ORIGIN}${path}`, nextConfig });
    for (const [key, value] of Object.entries(expected)) expect(res.headers.get(key)).toBe(value);
  });

  it.each(['/', '/chat', '/api/upload'])('leaves %s alone', async (path) => {
    const res = await unstable_getResponseFromNextConfig({ url: `${ORIGIN}${path}`, nextConfig });
    expect(res.headers.get('x-robots-tag')).toBeNull();
    expect(getRedirectUrl(res)).toBeNull();
  });
});
