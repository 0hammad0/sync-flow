import 'server-only';
import { err, ok, StepUpRequiredError, type Result } from '@/server/errors';
import type { AdminContext } from '@/server/auth/types';

// Step-up for destructive actions: the sign-in must be recent.
// Spec: docs/admin/03-features/01-auth.md ("Step-up rule").
// Call inside the action, after requireAdmin, before any side effect.

/** 15 minutes. `now - authTime ≤ 900 s` passes. */
export const STEP_UP_MAX_AGE_SEC = 15 * 60;

/**
 * Seconds since the user signed in. `authTime` is server-issued (seconds), so
 * compare with server time only. A slightly future authTime (clock skew between
 * Google and us) counts as 0. A missing or broken authTime counts as infinitely old.
 */
export function authAgeSec(ctx: Pick<AdminContext, 'authTime'>, nowMs: number = Date.now()): number {
  if (!Number.isFinite(ctx.authTime) || ctx.authTime <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(nowMs / 1000 - ctx.authTime));
}

/** Result form: `ok()` or `err(StepUpRequiredError)`. Does not throw. */
export function checkRecentAuth(
  ctx: Pick<AdminContext, 'authTime'>,
  maxAgeSec: number = STEP_UP_MAX_AGE_SEC,
  nowMs: number = Date.now(),
): Result<void, StepUpRequiredError> {
  const age = authAgeSec(ctx, nowMs);
  return age <= maxAgeSec ? ok() : err(new StepUpRequiredError(age));
}

/** Throws StepUpRequiredError when the sign-in is older than `maxAgeSec`. */
export function requireRecentAuth(
  ctx: Pick<AdminContext, 'authTime'>,
  maxAgeSec: number = STEP_UP_MAX_AGE_SEC,
  nowMs: number = Date.now(),
): void {
  const result = checkRecentAuth(ctx, maxAgeSec, nowMs);
  if (!result.ok) throw result.error;
}
