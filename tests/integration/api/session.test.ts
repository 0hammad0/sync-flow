import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Firebase Admin is replaced with spies: no network, no credentials.
const auth = vi.hoisted(() => ({
  verifySessionCookie: vi.fn(),
  revokeRefreshTokens: vi.fn(),
}));
vi.mock('@/shared/lib/firebase/admin', () => ({ adminAuth: () => auth, adminDb: vi.fn() }));

function authError(code: string) {
  return Object.assign(new Error(code), { code });
}

async function del(opts: { cookie?: string; everywhere?: boolean } = {}) {
  const { DELETE } = await import('@/app/api/session/route');
  const url = `http://localhost/api/session${opts.everywhere ? '?everywhere=1' : ''}`;
  const headers = opts.cookie ? { cookie: `__session=${opts.cookie}` } : undefined;
  return DELETE(new NextRequest(url, { method: 'DELETE', headers }));
}

function clearsCookie(res: Response): boolean {
  const set = res.headers.get('set-cookie') ?? '';
  return /__session=;/.test(set) && /Max-Age=0/i.test(set) && /Path=\//.test(set);
}

describe('DELETE /api/session', () => {
  beforeEach(() => {
    auth.verifySessionCookie.mockResolvedValue({ uid: 'u-1' });
    auth.revokeRefreshTokens.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  describe('sign out (this device)', () => {
    it('clears the cookie and touches nothing else', async () => {
      const res = await del({ cookie: 'c' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(clearsCookie(res)).toBe(true);
      expect(auth.verifySessionCookie).not.toHaveBeenCalled();
      expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('answers ok without a cookie', async () => {
      const res = await del();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(clearsCookie(res)).toBe(true);
    });
  });

  describe('sign out everywhere (?everywhere=1)', () => {
    it('revokes the user’s refresh tokens, then clears the cookie', async () => {
      const res = await del({ cookie: 'c', everywhere: true });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(auth.verifySessionCookie).toHaveBeenCalledWith('c');
      expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('u-1');
      expect(clearsCookie(res)).toBe(true);
    });

    it('with an invalid or expired cookie: nothing to revoke, plain sign-out', async () => {
      auth.verifySessionCookie.mockRejectedValue(authError('auth/session-cookie-expired'));
      const res = await del({ cookie: 'old', everywhere: true });
      expect(res.status).toBe(200);
      expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
      expect(clearsCookie(res)).toBe(true);
    });

    it('without a cookie: plain sign-out', async () => {
      const res = await del({ everywhere: true });
      expect(res.status).toBe(200);
      expect(auth.verifySessionCookie).not.toHaveBeenCalled();
      expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('when the revoke fails: still signs out here, but answers 500 revoke_failed', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      auth.revokeRefreshTokens.mockRejectedValue(new Error('UNAVAILABLE'));
      const res = await del({ cookie: 'c', everywhere: true });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ ok: false, error: 'revoke_failed' });
      expect(clearsCookie(res)).toBe(true);
    });

    it('when the cookie cannot be checked (server error): answers 500 revoke_failed', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      auth.verifySessionCookie.mockRejectedValue(new Error('network'));
      const res = await del({ cookie: 'c', everywhere: true });
      expect(res.status).toBe(500);
      expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
      expect(clearsCookie(res)).toBe(true);
    });

    it('a deleted user has nothing left to revoke: ok', async () => {
      auth.revokeRefreshTokens.mockRejectedValue(authError('auth/user-not-found'));
      const res = await del({ cookie: 'c', everywhere: true });
      expect(res.status).toBe(200);
    });

    it('only the exact value 1 means everywhere', async () => {
      const { DELETE } = await import('@/app/api/session/route');
      const res = await DELETE(
        new NextRequest('http://localhost/api/session?everywhere=true', {
          method: 'DELETE',
          headers: { cookie: '__session=c' },
        }),
      );
      expect(res.status).toBe(200);
      expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
    });
  });
});
