import 'server-only';

// Domain errors and Result<T, E> for the admin DAL.
// Spec: docs/admin/01-architecture/06-coding-standards.md ("Errors").
//
// Services return Result<T, DomainError> for expected failures. Auth helpers
// (requireAdmin, requireRecentAuth) throw, because every caller must stop.
// Actions turn either into { ok: false, error } with toActionFailure();
// routes map them to HTTP with each error's `status`.

export type DomainErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'step_up_required'
  | 'invalid'
  | 'not_found'
  | 'conflict'
  | 'rate_limited';

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
  /** HTTP status a route handler should answer with. */
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Why a request had no usable session. Lets the sign-in page pick its message. */
export type UnauthorizedReason = 'no_session' | 'invalid_session' | 'revoked' | 'disabled';

/** No valid session: signed out, expired, revoked or disabled. → 401 / sign-in. */
export class UnauthorizedError extends DomainError {
  readonly code = 'unauthorized' as const;
  readonly status = 401;

  constructor(readonly reason: UnauthorizedReason = 'no_session') {
    super(`Unauthorized: ${reason}`);
  }
}

/**
 * Signed in, but no admin role or not the needed permission. → 403 / forbidden screen.
 * `email` is the signed-in user's own email, for "Signed in as {email}". Server only.
 */
export class ForbiddenError extends DomainError {
  readonly code = 'forbidden' as const;
  readonly status = 403;

  constructor(readonly detail: { uid?: string; email?: string | null; permission?: string } = {}) {
    super(detail.permission ? `Forbidden: missing ${detail.permission}` : 'Forbidden');
  }
}

/** Destructive action, but the sign-in is older than the step-up window. → 403. */
export class StepUpRequiredError extends DomainError {
  readonly code = 'step_up_required' as const;
  readonly status = 403;

  constructor(readonly authAgeSec: number) {
    super('Step-up required: sign in again to continue');
  }
}

/** Input failed validation. `fields` maps field name → messages. → 400. */
export class ValidationError extends DomainError {
  readonly code = 'invalid' as const;
  readonly status = 400;

  constructor(
    readonly fields: Record<string, string[]> = {},
    message = 'Invalid input',
  ) {
    super(message);
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'not_found' as const;
  readonly status = 404;

  constructor(readonly resource = 'resource') {
    super(`Not found: ${resource}`);
  }
}

export class ConflictError extends DomainError {
  readonly code = 'conflict' as const;
  readonly status = 409;
}

export class RateLimitedError extends DomainError {
  readonly code = 'rate_limited' as const;
  readonly status = 429;

  constructor(readonly retryAfterSec: number) {
    super('Too many requests');
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

// ---------------------------------------------------------------------------
// Result<T, E>

export type Ok<T> = { readonly ok: true; readonly data: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = DomainError> = Ok<T> | Err<E>;

export function ok<T>(data: T): Ok<T>;
export function ok(): Ok<void>;
export function ok<T>(data?: T): Ok<T | void> {
  return { ok: true, data };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Server action results. Actions never throw to the client.

export type ActionFailure = {
  ok: false;
  /** `blocked`: the visitor blocklist stopped the action (T-27); `ref` is the support reference. */
  error: DomainErrorCode | 'internal' | 'blocked';
  fields?: Record<string, string[]>;
  authAgeSec?: number;
  retryAfterSec?: number;
  errorId?: string;
  ref?: string;
  /** Human message for `conflict` / `not_found` (e.g. "Already unblocked."). */
  message?: string;
};
export type ActionResult<T> = { ok: true; data: T } | ActionFailure;

/**
 * Map anything an action caught to the client-safe failure shape. Unknown errors
 * are logged with a new errorId (the UI shows "copy error id") and never echoed.
 * Rethrow Next.js control-flow errors (redirect, notFound) before calling this.
 */
export function toActionFailure(e: unknown): ActionFailure {
  if (e instanceof ValidationError) return { ok: false, error: e.code, fields: e.fields };
  if (e instanceof StepUpRequiredError) return { ok: false, error: e.code, authAgeSec: e.authAgeSec };
  if (e instanceof RateLimitedError) return { ok: false, error: e.code, retryAfterSec: e.retryAfterSec };
  if (e instanceof ConflictError) return { ok: false, error: e.code, message: e.message };
  if (e instanceof DomainError) return { ok: false, error: e.code };
  const errorId = crypto.randomUUID();
  console.error(`[admin] unexpected error ${errorId}`, e);
  return { ok: false, error: 'internal', errorId };
}
