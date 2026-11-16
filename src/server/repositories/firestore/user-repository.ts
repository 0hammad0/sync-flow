import 'server-only';

import type { Auth, UserRecord } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { isAdminRole } from '@/server/auth/permissions';
import type { AdminRole } from '@/server/auth/types';
import { ADMIN_CONFIG_DOCS, COLLECTIONS } from '@/server/firestore/collections';
import type { QuotaMeter } from '@/server/quota/quota-guard';
import type { AdminUser, RoleGrant, RoleIndexRebuild, UserAdmin, UserPage, UserReader } from '@/server/repositories/interfaces';
import { guarded } from './quota-call';

/** Firebase Auth's own cap for listUsers. */
const MAX_LIMIT = 1_000;
/** Firebase Auth's cap for getUsers. */
const AUTH_BATCH = 100;
/** Auth pages a role-index rebuild may scan (100k users) before it gives up without writing. */
const MAX_SCAN_PAGES = 100;
/** Keys of `admin_config/roles` are uids; anything else is ignored. */
const UID_SHAPE = /^[A-Za-z0-9]{1,128}$/;

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
 * role changes are admin actions); listAdmins reads that index (1 read).
 * The `role` claim stays the source of truth.
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

  async listAdmins(): Promise<AdminUser[]> {
    await this.quota.assertCan('reads');
    const snap = await guarded(this.quota, () =>
      this.db.collection(COLLECTIONS.adminConfig).doc(ADMIN_CONFIG_DOCS.roles).get(),
    );
    this.quota.record('reads', 1);
    const uids = Object.keys(snap.data() ?? {}).filter((uid) => UID_SHAPE.test(uid));
    const users: AdminUser[] = [];
    // Auth getUsers takes at most 100 identifiers per call. Auth calls are not Firestore reads.
    for (let i = 0; i < uids.length; i += AUTH_BATCH) {
      const res = await this.auth.getUsers(uids.slice(i, i + AUTH_BATCH).map((uid) => ({ uid })));
      users.push(...res.users.map(toAdminUser));
    }
    return users.sort((a, b) => (a.email ?? a.uid).localeCompare(b.email ?? b.uid));
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

  async rebuildRoleIndex(grant: Omit<RoleGrant, 'email'>): Promise<RoleIndexRebuild> {
    // 1. Every role claim, from one pass over Auth (Auth calls are not Firestore reads).
    const claims = new Map<string, { role: AdminRole; email: string | null }>();
    let pageToken: string | undefined;
    for (let page = 0; ; page += 1) {
      // Never write a half-scanned index: it would drop the admins not reached yet.
      if (page >= MAX_SCAN_PAGES) throw new Error('role index rebuild: too many Auth users to scan');
      const res = await this.auth.listUsers(MAX_LIMIT, pageToken);
      for (const user of res.users) {
        const role = user.customClaims?.role;
        if (isAdminRole(role)) claims.set(user.uid, { role, email: user.email ?? null });
      }
      if (!res.pageToken) break;
      pageToken = res.pageToken;
    }

    // 2. The current index (1 read), so unchanged entries keep who granted them and when.
    const ref = this.db.collection(COLLECTIONS.adminConfig).doc(ADMIN_CONFIG_DOCS.roles);
    const snap = await guarded(this.quota, () => ref.get());
    this.quota.record('reads', 1);
    const old = (snap.data() ?? {}) as Record<string, { role?: unknown; granted_by?: unknown; granted_at?: unknown } | undefined>;

    // 3. One full overwrite (1 write): stale entries go, missing ones come in.
    const next: Record<string, { email: string | null; role: AdminRole; granted_by: unknown; granted_at: unknown }> = {};
    let added = 0;
    let changed = 0;
    for (const [uid, { role, email }] of claims) {
      const prev = UID_SHAPE.test(uid) ? old[uid] : undefined;
      if (!prev) added += 1;
      else if (prev.role !== role) changed += 1;
      const keep = prev?.role === role && prev.granted_by !== undefined && prev.granted_at !== undefined;
      next[uid] = keep
        ? { email, role, granted_by: prev.granted_by, granted_at: prev.granted_at }
        : { email, role, granted_by: grant.grantedBy, granted_at: Timestamp.fromDate(grant.at) };
    }
    const removed = Object.keys(old).filter((uid) => !claims.has(uid)).length;
    await guarded(this.quota, () => ref.set(next));
    this.quota.record('writes', 1);
    return { admins: claims.size, added, removed, changed };
  }
}
