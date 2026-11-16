import 'server-only';

import type { AdminContext, AdminRole } from '@/server/auth/types';
import { ConflictError, ForbiddenError, NotFoundError, err, ok, type Result } from '@/server/errors';
import type { AdminUser, RoleIndexRebuild, UserAdmin, UserPage, UserReader } from '@/server/repositories/interfaces';
import type { AuditRequestInfo, AuditService } from '@/server/services/audit-service';

/** Firebase uids are 28 characters for email sign-in; accept the general shape. */
const UID_PATTERN = /^[A-Za-z0-9]{20,128}$/;

/** Shown when a role change would remove the last owner (13-users.md "Edge cases"). */
export const ROLE_MESSAGES = {
  lastOwner: 'This would leave no owner. Add another owner first.',
  indexMissing: 'The admin list is missing, so the last-owner check cannot run. Use "Rebuild from claims" in Settings → Roles, then try again.',
} as const;

export type UserActionOptions = { reason?: string | null; request?: AuditRequestInfo };

export type UserServiceDeps = {
  reader: UserReader;
  admin: UserAdmin;
  audit: Pick<AuditService, 'record'>;
  now?: () => Date;
};

/**
 * Users in Firebase Auth (docs/admin/03-features/13-users.md). Permission
 * checks (`users:disable`, `users:revoke`, `roles:write` + step-up) happen in
 * the actions. The guards here hold for every caller: no action on your own
 * account, so an owner can never demote or disable themselves.
 */
export class UserService {
  private readonly now: () => Date;

  constructor(private readonly deps: UserServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  list(query: { pageToken?: string | null; limit: number }): Promise<UserPage> {
    return this.deps.reader.list(query);
  }

  get(uid: string): Promise<AdminUser | null> {
    return this.deps.reader.get(uid);
  }

  /** Users in the `admin_config/roles` index (1 Firestore read). */
  listAdmins(): Promise<AdminUser[]> {
    return this.deps.reader.listAdmins();
  }

  /** Exact email, or a uid. Auth has no partial search. */
  async find(q: string): Promise<AdminUser | null> {
    const term = q.trim();
    if (!term) return null;
    if (term.includes('@')) return this.deps.reader.findByEmail(term.toLowerCase());
    return UID_PATTERN.test(term) ? this.deps.reader.get(term) : null;
  }

  /** Disables the account and ends its sessions. */
  async disableUser(ctx: AdminContext, uid: string, opts: UserActionOptions = {}): Promise<Result<AdminUser>> {
    const target = await this.target(ctx, uid);
    if (!target.ok) return target;
    await this.deps.admin.setDisabled(uid, true);
    await this.deps.admin.revokeSessions(uid);
    await this.audit(ctx, 'user.disable', target.data, { disabled: target.data.disabled }, { disabled: true }, opts);
    return ok({ ...target.data, disabled: true });
  }

  async enableUser(ctx: AdminContext, uid: string, opts: UserActionOptions = {}): Promise<Result<AdminUser>> {
    const target = await this.target(ctx, uid);
    if (!target.ok) return target;
    await this.deps.admin.setDisabled(uid, false);
    await this.audit(ctx, 'user.enable', target.data, { disabled: target.data.disabled }, { disabled: false }, opts);
    return ok({ ...target.data, disabled: false });
  }

  async revokeUserSessions(ctx: AdminContext, uid: string, opts: UserActionOptions = {}): Promise<Result<AdminUser>> {
    const target = await this.target(ctx, uid);
    if (!target.ok) return target;
    await this.deps.admin.revokeSessions(uid);
    await this.audit(ctx, 'user.revoke_sessions', target.data, null, null, opts);
    return ok(target.data);
  }

  /**
   * `null` removes the role. Also ends the user's sessions (new claims need a
   * new token). Removing an owner is refused (`conflict`) when no other owner
   * would be left, checked in a transaction on `admin_config/roles` so two
   * owners demoting each other at once cannot both win.
   */
  async setUserRole(
    ctx: AdminContext,
    uid: string,
    role: AdminRole | null,
    opts: UserActionOptions = {},
  ): Promise<Result<AdminUser>> {
    const target = await this.target(ctx, uid);
    if (!target.ok) return target;
    const changed = await this.deps.admin.setRole(uid, role, { email: target.data.email, grantedBy: ctx.uid, at: this.now() });
    if (!changed.ok) {
      return err(new ConflictError(changed.reason === 'last_owner' ? ROLE_MESSAGES.lastOwner : ROLE_MESSAGES.indexMissing));
    }
    await this.audit(ctx, 'role.set', target.data, { role: target.data.role }, { role }, opts);
    return ok({ ...target.data, role });
  }

  /**
   * "Rebuild from claims" (15-settings.md): rewrites the `admin_config/roles`
   * index from the role claims. Claims are not changed, so no `role.set` row
   * (spec: "read + index write, not a permission change").
   */
  rebuildAdminIndex(ctx: AdminContext): Promise<RoleIndexRebuild> {
    return this.deps.admin.rebuildRoleIndex({ grantedBy: ctx.uid, at: this.now() });
  }

  private async target(ctx: AdminContext, uid: string): Promise<Result<AdminUser>> {
    if (uid === ctx.uid) return err(new ForbiddenError({ uid: ctx.uid, email: ctx.email }));
    const user = await this.deps.reader.get(uid);
    return user ? ok(user) : err(new NotFoundError('user'));
  }

  private async audit(
    ctx: AdminContext,
    action: 'user.disable' | 'user.enable' | 'user.revoke_sessions' | 'role.set',
    user: AdminUser,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    opts: UserActionOptions,
  ): Promise<void> {
    await this.deps.audit.record({
      ctx,
      action,
      target: { type: 'user', id: user.uid },
      before: before ? { email: user.email, ...before } : { email: user.email },
      after,
      reason: opts.reason ?? null,
      request: opts.request,
    });
  }
}
