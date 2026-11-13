import 'server-only';
import { headers } from 'next/headers';
import { after } from 'next/server';
import type { AdminContext } from '@/server/auth/types';
import { getContainer } from '@/server/container';
import type { AuditRequestInfo, RecordAuditInput } from '@/server/services/audit-service';

// `auth.sign_in`: one row per admin session, written on the first admin page
// load after sign-in (docs/admin/03-features/01-auth.md).
//
// "Session" = one magic-link sign-in = one `auth_time` claim. Token refreshes
// and the 14-day session cookie keep the same `auth_time`; a new sign-in
// (including a step-up link) gets a new one.
//
// Cost, per page view after the first on an instance: 0 Firestore calls (the
// in-memory set answers). Per sign-in: 1 write. Across instances the row id is
// fixed (`signin_{uid}_{auth_time}`) and written with create(), so a second
// instance's attempt is refused by Firestore instead of adding a duplicate.
// No reads at any point.

export type SignInAuditDeps = {
  /** Append under `id` unless it exists. true = written, false = already there. Throws on failure. */
  recordOnce: (id: string, input: RecordAuditInput) => Promise<boolean>;
  /** Run after the response is sent (`after()` in production). */
  schedule: (task: () => Promise<void>) => void;
  /** Called during render: request APIs are not allowed inside `after()`. */
  readRequestMeta: () => Promise<AuditRequestInfo>;
  logger?: Pick<Console, 'error'>;
  /** Bound on remembered sessions per instance. */
  maxKeys?: number;
};

const DEFAULT_MAX_KEYS = 1_000;

/** Fixed row id, so every instance writes the same document. */
export function signInAuditId(uid: string, authTime: number): string {
  // A Firestore id cannot contain '/'; encodeURIComponent removes it.
  return `signin_${encodeURIComponent(uid)}_${authTime}`;
}

export function createSignInAudit(deps: SignInAuditDeps): (ctx: AdminContext) => void {
  const logger = deps.logger ?? console;
  const maxKeys = deps.maxKeys ?? DEFAULT_MAX_KEYS;
  // Insertion ordered; when full, the oldest half is forgotten. Forgetting
  // only costs one refused create() later, never a duplicate row.
  const seen = new Set<string>();

  function remember(id: string): void {
    if (seen.size >= maxKeys) {
      const drop = Math.ceil(seen.size / 2);
      for (const key of [...seen].slice(0, drop)) seen.delete(key);
    }
    seen.add(id);
  }

  return function recordSignInOnce(ctx: AdminContext): void {
    if (!Number.isFinite(ctx.authTime)) return;
    const id = signInAuditId(ctx.uid, ctx.authTime);
    if (seen.has(id)) return;
    // Marked before the write, so parallel renders on this instance do not
    // each schedule one.
    remember(id);

    // Never fails the page. On failure the key is forgotten so a later page
    // load retries.
    const fail = (error: unknown) => {
      seen.delete(id);
      logger.error('[admin] auth.sign_in write failed', error);
    };
    try {
      const request = deps.readRequestMeta().catch(() => ({ ip: null, userAgent: null }));
      deps.schedule(async () => {
        try {
          await deps.recordOnce(id, {
            ctx,
            action: 'auth.sign_in',
            after: { authTime: ctx.authTime },
            request: await request,
          });
        } catch (error) {
          fail(error);
        }
      });
    } catch (error) {
      fail(error);
    }
  };
}

// ---------------------------------------------------------------------------
// Default wiring

function firstForwardedIp(h: Headers): string | null {
  // Same order as require-admin.ts and src/shared/lib/rate-limit.ts clientKey().
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
}

/**
 * Call from the admin shell layout after `requireAdmin` succeeds. Returns at
 * once; the write runs after the response, so the first paint never waits.
 */
export const recordSignInOnce: (ctx: AdminContext) => void = createSignInAudit({
  recordOnce: (id, input) => getContainer().audit.recordOnce(id, input),
  schedule: (task) => after(task),
  readRequestMeta: async () => {
    const h = await headers();
    return { ip: firstForwardedIp(h), userAgent: h.get('user-agent') };
  },
});
