import 'server-only';
import { RateLimitedError } from '@/server/errors';
import { rateLimit } from '@/shared/lib/rate-limit';
import type { AdminContext } from '@/server/auth/types';

// Rate limit on admin writes (phase 5.4, 04-auth-and-security.md "Rate
// limit"): per admin uid, 30 writes a minute, sliding window.
//
// Per instance, in memory (src/shared/lib/rate-limit.ts): not shared across
// serverless instances, and no Firestore writes. It caps a runaway script or
// a stuck retry loop on one instance; it is not a cluster-wide quota.
//
// Every admin WRITE server action calls enforceAdminWriteLimit(ctx) right
// after requireAdmin(…), before step-up, zod or any side effect. Read-only
// actions do not. `npm run check:entry-points` flags an admin 'use server'
// export that does not call it.
//
// A refused write is not counted, so waiting `retryAfterSec` always works.
// The thrown RateLimitedError reaches the client through toActionFailure as
// { ok: false, error: 'rate_limited', retryAfterSec }; a route handler would
// answer it with tooManyRequests() (429 + Retry-After).

export const ADMIN_WRITE_LIMIT = { max: 30, windowMs: 60_000 } as const;

const key = (uid: string) => `admin-write:${uid}`;

/** Counts one write for this admin. `retryAfterSec` (≥ 1, whole seconds) when over the limit; does not throw. */
export function checkAdminWriteLimit(ctx: Pick<AdminContext, 'uid'>): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const { allowed, retryAfterMs } = rateLimit(key(ctx.uid), ADMIN_WRITE_LIMIT.max, ADMIN_WRITE_LIMIT.windowMs);
  return allowed ? { allowed: true } : { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
}

/**
 * Throws RateLimitedError when this admin is over 30 writes a minute.
 * Call right after `const ctx = await requireAdmin(permission)` inside the
 * action's try, so the existing catch → toActionFailure() returns
 * `{ ok: false, error: 'rate_limited', retryAfterSec }`.
 */
export function enforceAdminWriteLimit(ctx: Pick<AdminContext, 'uid'>): void {
  const result = checkAdminWriteLimit(ctx);
  if (!result.allowed) throw new RateLimitedError(result.retryAfterSec);
}
