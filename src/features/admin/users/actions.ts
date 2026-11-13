'use server';

import { headers } from 'next/headers';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/require-admin';
import { requireRecentAuth } from '@/server/auth/step-up';
import type { Permission } from '@/server/auth/permissions';
import type { AdminContext } from '@/server/auth/types';
import { assertNotBlocked } from '@/server/blocklist/assert-not-blocked';
import { clientIp } from '@/server/blocklist/request';
import { getContainer } from '@/server/container';
import { ForbiddenError, NotFoundError, toActionFailure, type ActionFailure, type ActionResult, type Result } from '@/server/errors';
import type { AdminUser } from '@/server/repositories/interfaces';
import type { AuditRequestInfo } from '@/server/services/audit-service';
import { USERS_TAG } from './queries';
import { setUserRoleSchema, userActionSchema } from './schemas';

// Users actions (13-users.md "Actions"). Each: block check (T-27) →
// requireAdmin(permission) (T-6) → step-up where the spec says so → zod →
// UserService, which refuses any action on your own account (so an owner can
// never disable or demote themselves) and writes the audit row.

export type UserActionData = { uid: string; disabled: boolean; role: AdminUser['role'] };

type Step = { permission: Permission; stepUp: boolean };

async function requestInfo(): Promise<AuditRequestInfo> {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get('user-agent') };
}

function failure(error: unknown): ActionFailure {
  if (error instanceof ForbiddenError && error.detail.uid && !error.detail.permission) {
    return { ok: false, error: 'forbidden', message: 'You cannot do this to your own account.' };
  }
  if (error instanceof NotFoundError) return { ok: false, error: 'not_found', message: 'This user no longer exists.' };
  return toActionFailure(error);
}

/** The shared frame: block check → auth → step-up → zod → run → cache clear. */
async function run<S extends z.ZodType>(
  step: Step,
  schema: S,
  input: unknown,
  fn: (ctx: AdminContext, data: z.output<S>, request: AuditRequestInfo) => Promise<Result<AdminUser>>,
): Promise<ActionResult<UserActionData>> {
  try {
    const ctx = await requireAdmin(step.permission);
    if (step.stepUp) requireRecentAuth(ctx);
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid', fields: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    const result = await fn(ctx, parsed.data, await requestInfo());
    if (!result.ok) return failure(result.error);
    updateTag(USERS_TAG);
    return { ok: true, data: { uid: result.data.uid, disabled: result.data.disabled, role: result.data.role } };
  } catch (e) {
    return failure(e);
  }
}

/** Disable + end all sessions. `users:disable`, step-up. Audit `user.disable`. */
export async function disableUser(input: unknown): Promise<ActionResult<UserActionData>> {
  const blocked = await assertNotBlocked();
  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
  return run({ permission: 'users:disable', stepUp: true }, userActionSchema, input, (ctx, d, request) =>
    getContainer().users.disableUser(ctx, d.uid, { reason: d.reason || null, request }),
  );
}

/** Undo a disable. `users:disable`, no step-up (13-users.md). Audit `user.enable`. */
export async function enableUser(input: unknown): Promise<ActionResult<UserActionData>> {
  const blocked = await assertNotBlocked();
  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
  return run({ permission: 'users:disable', stepUp: false }, userActionSchema, input, (ctx, d, request) =>
    getContainer().users.enableUser(ctx, d.uid, { reason: d.reason || null, request }),
  );
}

/** Sign out everywhere. `users:revoke`, step-up. Audit `user.revoke_sessions`. */
export async function revokeUserSessions(input: unknown): Promise<ActionResult<UserActionData>> {
  const blocked = await assertNotBlocked();
  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
  return run({ permission: 'users:revoke', stepUp: true }, userActionSchema, input, (ctx, d, request) =>
    getContainer().users.revokeUserSessions(ctx, d.uid, { reason: d.reason || null, request }),
  );
}

/** Set or remove the role claim. `roles:write` (owner), step-up. Granting owner needs "OWNER" typed. Audit `role.set`. */
export async function setUserRole(input: unknown): Promise<ActionResult<UserActionData>> {
  const blocked = await assertNotBlocked();
  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
  return run({ permission: 'roles:write', stepUp: true }, setUserRoleSchema, input, (ctx, d, request) =>
    getContainer().users.setUserRole(ctx, d.uid, d.role === 'none' ? null : d.role, { reason: d.reason || null, request }),
  );
}
