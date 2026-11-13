import 'server-only';

import type { Auth, UserRecord } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { isAdminRole } from '@/server/auth/permissions';
import type { AdminRole } from '@/server/auth/types';
import { ADMIN_CONFIG_DOCS, COLLECTIONS } from '@/server/firestore/collections';
import type { QuotaMeter } from '@/server/quota/quota-guard';
import type { AdminUser, RoleGrant, UserAdmin, UserPage, UserReader } from '@/server/repositories/interfaces';
import { guarded } from './quota-call';

/** Firebase Auth's own cap for listUsers. */
const MAX_LIMIT = 1_000;

function isUserNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'auth/user-not-found';
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toAdminUser(user: UserRecord): AdminUser {
  const role = user.customClaims?.role;
  return {
    uid: user.uid,
    email: user.email ?? null,
    role: isAdminRole(role) ? role : null,
    disabled: user.disabled,
    createdAt: toDate(user.metadata.creationTime),
    lastSignInAt: toDate(user.metadata.lastSignInTime),
    lastRefreshAt: toDate(user.metadata.lastRefreshTime),
  };
}

/**
 * Users live in Firebase Auth (docs/admin/03-features/13-users.md). Auth
 * calls do not touch the Firestore quota. The one Firestore write is the
 * `admin_config/roles` index on setRole (1 write, counted, never blocked:
 * role changes are admin actions). The `role` claim stays the source of truth.
 */
export class FirebaseUserRepository implements UserReader, UserAdmin {
  constructor(
    private readonly auth: Auth,
    private readonly db: Firestore,
    private readonly quota: QuotaMeter,
  ) {}

  async list(query: { pageToken?: string | null; limit: number }): Promise<UserPage> {
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), MAX_LIMIT);
    const res = await this.auth.listUsers(limit, query.pageToken ?? undefined);
    return { users: res.users.map(toAdminUser), nextPageToken: res.pageToken ?? null };
  }

  async get(uid: string): Promise<AdminUser | null> {
    try {
      return toAdminUser(await this.auth.getUser(uid));
    } catch (error) {
      if (isUserNotFound(error)) return null;
      throw error;
    }
  }

  async findByEmail(email: string): Promise<AdminUser | null> {
    try {
      return toAdminUser(await this.auth.getUserByEmail(email));
    } catch (error) {
      if (isUserNotFound(error)) return null;
      throw error;
    }
  }

  async setDisabled(uid: string, disabled: boolean): Promise<void> {
    await this.auth.updateUser(uid, { disabled });
  }

  async revokeSessions(uid: string): Promise<void> {
    await this.auth.revokeRefreshTokens(uid);
  }

  async setRole(uid: string, role: AdminRole | null, grant: RoleGrant): Promise<void> {
    const user = await this.auth.getUser(uid);
    const claims: Record<string, unknown> = { ...(user.customClaims ?? {}) };
    if (role) claims.role = role;
    else delete claims.role;
    await this.auth.setCustomUserClaims(uid, claims);
    // New claims reach the user only with a new token: end their sessions.
    await this.auth.revokeRefreshTokens(uid);

    const entry = role
      ? { email: grant.email, role, granted_by: grant.grantedBy, granted_at: Timestamp.fromDate(grant.at) }
      : FieldValue.delete();
    await guarded(this.quota, () =>
      this.db
        .collection(COLLECTIONS.adminConfig)
        .doc(ADMIN_CONFIG_DOCS.roles)
        .set({ [uid]: entry }, { merge: true }),
    );
    this.quota.record('writes', 1);
  }
}
