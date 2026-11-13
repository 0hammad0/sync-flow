import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminAuthErrorResponse,
  createRequireAdmin,
  DENIED_WINDOW_MS,
  requireAdminForRoute,
  type DeniedEvent,
  type RequireAdminDeps,
  type SessionClaims,
} from '@/server/auth/require-admin';
import { ForbiddenError, StepUpRequiredError, UnauthorizedError, ValidationError } from '@/server/errors';

// The default-wired requireAdmin touches next/headers and Firebase; keep the
// module import side-effect free in tests.
vi.mock('@/shared/lib/firebase/admin', () => ({ adminAuth: vi.fn(), adminDb: vi.fn() }));

function authError(code: string) {
  return Object.assign(new Error(code), { code });
}

const OWNER: SessionClaims = { uid: 'u-owner', email: 'o@example.com', auth_time: 1_700_000_000, role: 'owner' };

type Harness = {
  deps: RequireAdminDeps;
  denied: DeniedEvent[];
  verify: ReturnType<typeof vi.fn>;
  clock: { ms: number };
};

function harness(opts: { cookie?: string; claims?: SessionClaims; verifyError?: unknown } = {}): Harness {
  const denied: DeniedEvent[] = [];
  const clock = { ms: 1_700_000_100_000 };
  const verify = vi.fn(async (): Promise<SessionClaims> => {
    if (opts.verifyError) throw opts.verifyError;
    return opts.claims ?? OWNER;
  });
  const deps: RequireAdminDeps = {
    readSessionCookie: async () => opts.cookie,
    verifySessionCookie: verify,
    readRequestMeta: async () => ({ ip: '203.0.113.7', userAgent: 'test-agent' }),
    onDenied: (e) => {
      denied.push(e);
    },
    now: () => clock.ms,
  };
  return { deps, denied, verify, clock };
}

describe('requireAdmin', () => {
  let h: Harness;

  describe('no cookie', () => {
    beforeEach(() => {
      h = harness({ cookie: undefined });
    });

    it('throws UnauthorizedError(no_session) without calling Firebase', async () => {
      const { requireAdmin } = createRequireAdmin(h.deps);
      const e = await requireAdmin('analytics:read').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(UnauthorizedError);
      expect((e as UnauthorizedError).reason).toBe('no_session');
      expect(h.verify).not.toHaveBeenCalled();
    });

    it('does not audit anonymous requests', async () => {
      const { requireAdmin } = createRequireAdmin(h.deps);
      await requireAdmin('analytics:read').catch(() => {});
      expect(h.denied).toEqual([]);
    });
  });

  it('bad cookie → UnauthorizedError(invalid_session), audited by IP', async () => {
    h = harness({ cookie: 'garbage', verifyError: authError('auth/argument-error') });
    const { requireAdmin } = createRequireAdmin(h.deps);
    const e = await requireAdmin('analytics:read').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnauthorizedError);
    expect((e as UnauthorizedError).reason).toBe('invalid_session');
    expect(h.denied).toHaveLength(1);
    expect(h.denied[0]).toMatchObject({ reason: 'invalid_session', uid: null, ip: '203.0.113.7' });
  });

  it('expired cookie → invalid_session', async () => {
    h = harness({ cookie: 'old', verifyError: authError('auth/session-cookie-expired') });
    const e = await createRequireAdmin(h.deps).requireAdmin('analytics:read').catch((x: unknown) => x);
    expect((e as UnauthorizedError).reason).toBe('invalid_session');
  });

  it('revoked cookie → UnauthorizedError(revoked); verifies with checkRevoked=true', async () => {
    h = harness({ cookie: 'c', verifyError: authError('auth/session-cookie-revoked') });
    const e = await createRequireAdmin(h.deps).requireAdmin('analytics:read').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnauthorizedError);
    expect((e as UnauthorizedError).reason).toBe('revoked');
    expect(h.verify).toHaveBeenCalledWith('c', true);
  });

  it('disabled user → UnauthorizedError(disabled)', async () => {
    h = harness({ cookie: 'c', verifyError: authError('auth/user-disabled') });
    const e = await createRequireAdmin(h.deps).requireAdmin('analytics:read').catch((x: unknown) => x);
    expect((e as UnauthorizedError).reason).toBe('disabled');
  });

  it('non-auth failure (network) is rethrown, not turned into a 401', async () => {
    const boom = new Error('ECONNRESET');
    h = harness({ cookie: 'c', verifyError: boom });
    await expect(createRequireAdmin(h.deps).requireAdmin('analytics:read')).rejects.toBe(boom);
    expect(h.denied).toEqual([]);
  });

  it('no role → ForbiddenError with the signed-in email, audited as no_role', async () => {
    h = harness({ cookie: 'c', claims: { uid: 'u1', email: 'sara@example.com', auth_time: 1 } });
    const e = await createRequireAdmin(h.deps).requireAdmin('analytics:read').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ForbiddenError);
    expect((e as ForbiddenError).detail).toEqual({ uid: 'u1', email: 'sara@example.com', permission: 'analytics:read' });
    expect(h.denied).toHaveLength(1);
    expect(h.denied[0]).toEqual({
      reason: 'no_role',
      permission: 'analytics:read',
      uid: 'u1',
      email: 'sara@example.com',
      role: null,
      ip: '203.0.113.7',
      userAgent: 'test-agent',
      at: h.clock.ms,
    });
  });

  it('unknown role string counts as no role', async () => {
    h = harness({ cookie: 'c', claims: { uid: 'u1', auth_time: 1, role: 'admin' } });
    const e = await createRequireAdmin(h.deps).requireAdmin('analytics:read').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ForbiddenError);
    expect(h.denied[0].reason).toBe('no_role');
  });

  it('wrong role → ForbiddenError, audited as missing_permission', async () => {
    h = harness({ cookie: 'c', claims: { uid: 'u2', email: 'v@example.com', auth_time: 1, role: 'viewer' } });
    const e = await createRequireAdmin(h.deps).requireAdmin('files:delete').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ForbiddenError);
    expect(h.denied[0]).toMatchObject({ reason: 'missing_permission', role: 'viewer', permission: 'files:delete' });
  });

  it('OK → small AdminContext, never the raw token', async () => {
    h = harness({ cookie: 'c', claims: { ...OWNER, ...{ firebase: { secret: 1 } } } as SessionClaims });
    const ctx = await createRequireAdmin(h.deps).requireAdmin('settings:write');
    expect(ctx).toEqual({ uid: 'u-owner', email: 'o@example.com', role: 'owner', authTime: 1_700_000_000 });
    expect(h.denied).toEqual([]);
  });

  it('missing email claim → email null', async () => {
    h = harness({ cookie: 'c', claims: { uid: 'u3', auth_time: 5, role: 'moderator' } });
    const ctx = await createRequireAdmin(h.deps).requireAdmin('files:delete');
    expect(ctx).toEqual({ uid: 'u3', email: null, role: 'moderator', authTime: 5 });
  });

  describe('auth.denied rate limit (1 per uid or IP per 10 min)', () => {
    it('same uid within the window writes once, after the window writes again', async () => {
      h = harness({ cookie: 'c', claims: { uid: 'u1', auth_time: 1 } });
      const { requireAdmin } = createRequireAdmin(h.deps);
      await requireAdmin('analytics:read').catch(() => {});
      h.clock.ms += DENIED_WINDOW_MS - 1;
      await requireAdmin('analytics:read').catch(() => {});
      expect(h.denied).toHaveLength(1);
      h.clock.ms += 1;
      await requireAdmin('analytics:read').catch(() => {});
      expect(h.denied).toHaveLength(2);
    });

    it('different uids are limited separately', async () => {
      const claims: SessionClaims = { uid: 'a', auth_time: 1 };
      h = harness({ cookie: 'c', claims });
      const { requireAdmin } = createRequireAdmin(h.deps);
      await requireAdmin('analytics:read').catch(() => {});
      claims.uid = 'b';
      await requireAdmin('analytics:read').catch(() => {});
      expect(h.denied.map((d) => d.uid)).toEqual(['a', 'b']);
    });

    it('a failing audit write still denies with the auth error', async () => {
      h = harness({ cookie: 'c', claims: { uid: 'u1', auth_time: 1 } });
      h.deps.onDenied = () => {
        throw new Error('firestore down');
      };
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(createRequireAdmin(h.deps).requireAdmin('analytics:read')).rejects.toBeInstanceOf(ForbiddenError);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it('verifies once per request when memo is a real per-request cache', async () => {
    h = harness({ cookie: 'c' });
    const memo = <A extends unknown[], R>(fn: (...args: A) => R) => {
      const seen = new Map<string, R>();
      return (...args: A): R => {
        const key = JSON.stringify(args);
        if (!seen.has(key)) seen.set(key, fn(...args));
        return seen.get(key) as R;
      };
    };
    const { requireAdmin } = createRequireAdmin({ ...h.deps, memo });
    await requireAdmin('analytics:read');
    await requireAdmin('files:delete');
    await requireAdmin('analytics:read');
    expect(h.verify).toHaveBeenCalledTimes(1);
  });
});

describe('route helpers', () => {
  it('maps UnauthorizedError to 401 JSON', async () => {
    const res = adminAuthErrorResponse(new UnauthorizedError('revoked'));
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(res?.headers.get('cache-control')).toBe('private, no-store');
  });

  it('maps ForbiddenError to 403 JSON without leaking the email', async () => {
    const res = adminAuthErrorResponse(new ForbiddenError({ uid: 'u', email: 'x@example.com', permission: 'files:read' }));
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ ok: false, error: 'forbidden' });
  });

  it('maps StepUpRequiredError to 403 step_up_required', async () => {
    const res = adminAuthErrorResponse(new StepUpRequiredError(1200));
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ ok: false, error: 'step_up_required', authAgeSec: 1200 });
  });

  it('returns null for other errors', () => {
    expect(adminAuthErrorResponse(new ValidationError())).toBeNull();
    expect(adminAuthErrorResponse(new Error('x'))).toBeNull();
  });

  it('requireAdminForRoute returns ctx or a response, never redirects', async () => {
    const okCheck = async () => ({ uid: 'u', email: null, role: 'owner' as const, authTime: 1 });
    expect(await requireAdminForRoute('files:read', okCheck)).toEqual({
      ok: true,
      ctx: { uid: 'u', email: null, role: 'owner', authTime: 1 },
    });

    const denied = await requireAdminForRoute('files:read', async () => {
      throw new UnauthorizedError();
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.response.status).toBe(401);
      expect(denied.response.headers.get('location')).toBeNull();
    }
  });

  it('requireAdminForRoute rethrows non-auth errors', async () => {
    const boom = new Error('boom');
    await expect(
      requireAdminForRoute('files:read', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
