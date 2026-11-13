import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { adminAuth } from '@/shared/lib/firebase/admin';
import { SESSION_COOKIE } from '@/shared/lib/firebase/session';
import { can, isAdminRole, type Permission } from '@/server/auth/permissions';
import type { AdminContext, AdminRole } from '@/server/auth/types';
import {
  ForbiddenError,
  StepUpRequiredError,
  UnauthorizedError,
  type UnauthorizedReason,
} from '@/server/errors';

// requireAdmin(permission): the only auth check for admin pages, routes and
// actions (T-6). The proxy only redirects signed-out page views; it is not security.
// Spec: docs/admin/01-architecture/04-auth-and-security.md ("requireAdmin").
//
//   __session cookie → verifySessionCookie(cookie, checkRevoked=true)
//     → `role` claim → permission map → AdminContext
//
// Throws UnauthorizedError (no/bad/revoked/disabled session) or ForbiddenError
// (no role, or role lacks the permission). Pages: catch and render sign-in or
// forbidden. Routes: requireAdminForRoute(). Actions: toActionFailure().

/** The decoded session-cookie fields this module reads. */
export type SessionClaims = {
  uid: string;
  email?: string;
  /** Seconds since epoch, server-issued. */
  auth_time: number;
  role?: unknown;
};

export type DeniedReason = Exclude<UnauthorizedReason, 'no_session'> | 'no_role' | 'missing_permission';

export type RequestMeta = { ip: string | null; userAgent: string | null };

/** What onDenied receives. The audit wiring turns it into an `auth.denied` row. */
export type DeniedEvent = RequestMeta & {
  reason: DeniedReason;
  permission: Permission;
  uid: string | null;
  email: string | null;
  role: AdminRole | null;
  /** ms since epoch, from deps.now(). */
  at: number;
};

export type RequireAdminDeps = {
  readSessionCookie: () => Promise<string | undefined>;
  verifySessionCookie: (cookie: string, checkRevoked: boolean) => Promise<SessionClaims>;
  /** Only called on a denial. */
  readRequestMeta: () => Promise<RequestMeta>;
  /** Writes `auth.denied`. Already rate limited here; errors are logged, never thrown. */
  onDenied: (event: DeniedEvent) => Promise<void> | void;
  /** ms since epoch. */
  now: () => number;
  /** Per-request memo, React `cache` in production. Identity in tests. */
  memo?: <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => R;
  /** One onDenied per uid (or IP) per window. Default 10 min (11-audit-log.md). */
  deniedWindowMs?: number;
};

export const DENIED_WINDOW_MS = 10 * 60 * 1000;
const DENIED_LIMITER_MAX_KEYS = 5000;

type SessionState =
  | { kind: 'ok'; claims: SessionClaims }
  | { kind: 'none'; reason: UnauthorizedReason };

/**
 * Firebase Admin auth errors carry `code: 'auth/…'`. Those mean "no usable
 * session". Anything else (network failure on the revocation check) is a server
 * error and is rethrown, so an outage shows the error page, not a sign-in loop.
 */
function classifyVerifyError(e: unknown): UnauthorizedReason | null {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !code.startsWith('auth/')) return null;
  if (code === 'auth/session-cookie-revoked') return 'revoked';
  if (code === 'auth/user-disabled') return 'disabled';
  return 'invalid_session';
}

/** In-memory, per server instance. Bounded so a flood of keys cannot grow it forever. */
function createDeniedLimiter(windowMs: number) {
  const last = new Map<string, number>();
  return (key: string, at: number): boolean => {
    const prev = last.get(key);
    if (prev !== undefined && at - prev < windowMs) return false;
    if (last.size >= DENIED_LIMITER_MAX_KEYS) {
      for (const [k, t] of last) if (at - t >= windowMs) last.delete(k);
      if (last.size >= DENIED_LIMITER_MAX_KEYS) last.clear();
    }
    last.set(key, at);
    return true;
  };
}

export function createRequireAdmin(deps: RequireAdminDeps) {
  const memo = deps.memo ?? (<A extends unknown[], R>(fn: (...args: A) => R) => fn);
  const allowDenied = createDeniedLimiter(deps.deniedWindowMs ?? DENIED_WINDOW_MS);

  const loadSession = memo(async (): Promise<SessionState> => {
    const cookie = await deps.readSessionCookie();
    if (!cookie) return { kind: 'none', reason: 'no_session' };
    try {
      return { kind: 'ok', claims: await deps.verifySessionCookie(cookie, true) };
    } catch (e) {
      const reason = classifyVerifyError(e);
      if (!reason) throw e;
      return { kind: 'none', reason };
    }
  });

  async function recordDenied(event: Omit<DeniedEvent, 'ip' | 'userAgent' | 'at'>): Promise<void> {
    try {
      const at = deps.now();
      const meta = await deps.readRequestMeta();
      const key = event.uid ? `uid:${event.uid}` : `ip:${meta.ip ?? 'unknown'}`;
      if (!allowDenied(key, at)) return;
      await deps.onDenied({ ...event, ...meta, at });
    } catch (e) {
      // A failed audit write must not turn a 401/403 into a 500.
      console.error('[admin] auth.denied write failed', e);
    }
  }

  const requireAdmin = memo(async (permission: Permission): Promise<AdminContext> => {
    const session = await loadSession();

    if (session.kind === 'none') {
      // No cookie at all is an anonymous request, not an admin event: not audited
      // (unbounded with rotating IPs, and page views are already redirected by the
      // proxy). A cookie that fails verification is audited.
      if (session.reason !== 'no_session') {
        await recordDenied({ reason: session.reason, permission, uid: null, email: null, role: null });
      }
      throw new UnauthorizedError(session.reason);
    }

    const { claims } = session;
    const email = claims.email ?? null;
    const role = isAdminRole(claims.role) ? claims.role : null;

    if (!role || !can(role, permission)) {
      await recordDenied({
        reason: role ? 'missing_permission' : 'no_role',
        permission,
        uid: claims.uid,
        email,
        role,
      });
      throw new ForbiddenError({ uid: claims.uid, email, permission });
    }

    return { uid: claims.uid, email, role, authTime: claims.auth_time };
  });

  return { requireAdmin };
}

// ---------------------------------------------------------------------------
// Default wiring

function firstForwardedIp(h: Headers): string | null {
  // Same order as src/shared/lib/rate-limit.ts clientKey(). Vercel overwrites both.
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
}

const defaultInstance = createRequireAdmin({
  readSessionCookie: async () => (await cookies()).get(SESSION_COOKIE)?.value,
  verifySessionCookie: (cookie, checkRevoked) =>
    adminAuth().verifySessionCookie(cookie, checkRevoked) as Promise<SessionClaims>,
  readRequestMeta: async () => {
    const h = await headers();
    return { ip: firstForwardedIp(h), userAgent: h.get('user-agent') };
  },
  // TODO(0.6 wiring): container.audit — write `auth.denied` via AuditService
  // (ideally inside `after()` so the 401/403 does not wait for Firestore).
  onDenied: () => {},
  now: () => Date.now(),
  memo: cache,
});

/**
 * Verify the session and check `permission`. One verify per request (`cache`).
 * @throws UnauthorizedError | ForbiddenError
 */
export const requireAdmin: (permission: Permission) => Promise<AdminContext> = defaultInstance.requireAdmin;

// ---------------------------------------------------------------------------
// Route handlers

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * Map an auth error to a JSON response: 401 `unauthorized`, 403 `forbidden`,
 * 403 `step_up_required` (+ authAgeSec). Returns null for anything else, so the
 * caller can rethrow or map it.
 */
export function adminAuthErrorResponse(e: unknown): Response | null {
  if (e instanceof UnauthorizedError) {
    return Response.json({ ok: false, error: e.code }, { status: 401, headers: NO_STORE });
  }
  if (e instanceof StepUpRequiredError) {
    const authAgeSec = Number.isFinite(e.authAgeSec) ? e.authAgeSec : null;
    return Response.json({ ok: false, error: e.code, authAgeSec }, { status: 403, headers: NO_STORE });
  }
  if (e instanceof ForbiddenError) {
    return Response.json({ ok: false, error: e.code }, { status: 403, headers: NO_STORE });
  }
  return null;
}

export type RouteAuth = { ok: true; ctx: AdminContext } | { ok: false; response: Response };

/**
 * For route handlers:
 *   const auth = await requireAdminForRoute('files:read');
 *   if (!auth.ok) return auth.response;
 * Never redirects (`/api/admin/**` gets JSON 401/403, not the sign-in page).
 */
export async function requireAdminForRoute(
  permission: Permission,
  check: (permission: Permission) => Promise<AdminContext> = requireAdmin,
): Promise<RouteAuth> {
  try {
    return { ok: true, ctx: await check(permission) };
  } catch (e) {
    const response = adminAuthErrorResponse(e);
    if (response) return { ok: false, response };
    throw e;
  }
}
