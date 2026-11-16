import type { AdminRole } from '@/server/auth/types';
import type {
  AdminUser,
  BucketTotals,
  CronJob,
  CronRun,
  CronRunRepository,
  NewCronRun,
  RoleChangeResult,
  RoleGrant,
  RoleIndexRebuild,
  StorageRemover,
  StorageStats,
  UserAdmin,
  UserPage,
  UserReader,
} from '@/server/repositories/interfaces';

/** In-memory `admin_cron_runs`. */
export class MemoryCronRunRepository implements CronRunRepository {
  readonly rows: CronRun[] = [];
  private seq = 0;

  async append(run: NewCronRun): Promise<string> {
    this.seq += 1;
    const id = `run-${String(this.seq).padStart(6, '0')}`;
    this.rows.push(structuredClone({ ...run, id }));
    return id;
  }

  async listRecent(job: CronJob, limit: number): Promise<CronRun[]> {
    return this.rows
      .filter((r) => r.job === job)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, Math.min(Math.max(Math.floor(limit), 1), 50))
      .map((r) => structuredClone(r));
  }
}

/**
 * In-memory Firebase Auth users. `calls` records admin writes in order, so
 * tests can check "disable also revokes" and "role change revokes".
 */
export class MemoryUserRepository implements UserReader, UserAdmin {
  readonly users = new Map<string, AdminUser>();
  readonly roles = new Map<string, { role: AdminRole; email: string | null; grantedBy: string; at: Date }>();
  readonly calls: string[] = [];
  /**
   * Whether the `admin_config/roles` doc exists. It also counts as existing
   * once `roles` has entries (tests seed it directly). Set false with an empty
   * `roles` to model a missing index.
   */
  roleIndexWritten = false;

  addUser(user: Partial<AdminUser> & { uid: string }): void {
    this.users.set(user.uid, {
      email: null,
      role: null,
      disabled: false,
      createdAt: null,
      lastSignInAt: null,
      lastRefreshAt: null,
      ...user,
    });
  }

  async list(query: { pageToken?: string | null; limit: number }): Promise<UserPage> {
    const all = [...this.users.values()].sort((a, b) => a.uid.localeCompare(b.uid));
    const start = query.pageToken ? Number(query.pageToken) : 0;
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), 1000);
    const users = all.slice(start, start + limit).map((u) => structuredClone(u));
    return { users, nextPageToken: start + limit < all.length ? String(start + limit) : null };
  }

  async get(uid: string): Promise<AdminUser | null> {
    const user = this.users.get(uid);
    return user ? structuredClone(user) : null;
  }

  async findByEmail(email: string): Promise<AdminUser | null> {
    const user = [...this.users.values()].find((u) => u.email === email);
    return user ? structuredClone(user) : null;
  }

  async listAdmins(): Promise<AdminUser[]> {
    return [...this.roles.keys()]
      .map((uid) => this.users.get(uid))
      .filter((u): u is AdminUser => Boolean(u))
      .map((u) => structuredClone(u))
      .sort((a, b) => (a.email ?? a.uid).localeCompare(b.email ?? b.uid));
  }

  async setDisabled(uid: string, disabled: boolean): Promise<void> {
    this.calls.push(`disabled:${uid}:${disabled}`);
    this.mustGet(uid).disabled = disabled;
  }

  async revokeSessions(uid: string): Promise<void> {
    this.mustGet(uid);
    this.calls.push(`revoke:${uid}`);
  }

  /**
   * Same order as the Firestore repo: removing an owner decides and writes
   * the index first (the synchronous block below stands in for the
   * transaction: no await between read and write), then the claim. The
   * `await` before it lets concurrent calls interleave, as real ones do.
   */
  async setRole(uid: string, role: AdminRole | null, grant: RoleGrant): Promise<RoleChangeResult> {
    await Promise.resolve(); // the Auth getUser round trip in the real repo
    const user = this.mustGet(uid);
    const writeIndex = () => {
      this.roleIndexWritten = true;
      if (role) this.roles.set(uid, { role, email: grant.email, grantedBy: grant.grantedBy, at: grant.at });
      else this.roles.delete(uid);
    };
    if (user.role === 'owner' && role !== 'owner') {
      if (!this.roleIndexWritten && this.roles.size === 0) return { ok: false, reason: 'index_missing' };
      const others = [...this.roles].filter(([key, e]) => key !== uid && e.role === 'owner');
      if (others.length === 0) return { ok: false, reason: 'last_owner' };
      writeIndex();
      this.calls.push(`role:${uid}:${role}`);
      user.role = role;
      this.calls.push(`revoke:${uid}`);
      return { ok: true };
    }
    this.calls.push(`role:${uid}:${role}`);
    user.role = role;
    this.calls.push(`revoke:${uid}`);
    writeIndex();
    return { ok: true };
  }

  async rebuildRoleIndex(grant: Omit<RoleGrant, 'email'>): Promise<RoleIndexRebuild> {
    this.calls.push('rebuild-roles');
    const claims = [...this.users.values()].filter((u) => u.role);
    const next = new Map<string, { role: AdminRole; email: string | null; grantedBy: string; at: Date }>();
    let added = 0;
    let changed = 0;
    for (const user of claims) {
      const role = user.role!;
      const prev = this.roles.get(user.uid);
      if (!prev) added += 1;
      else if (prev.role !== role) changed += 1;
      next.set(
        user.uid,
        prev?.role === role ? { ...prev, email: user.email } : { role, email: user.email, grantedBy: grant.grantedBy, at: grant.at },
      );
    }
    const removed = [...this.roles.keys()].filter((uid) => !next.has(uid)).length;
    this.roles.clear();
    for (const [uid, entry] of next) this.roles.set(uid, entry);
    this.roleIndexWritten = true;
    return { admins: next.size, added, removed, changed };
  }

  private mustGet(uid: string): AdminUser {
    const user = this.users.get(uid);
    if (!user) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
    return user;
  }
}

/** R2 stand-in. `failKeys` makes deleteObject throw for those keys. */
export class MemoryStorage implements StorageRemover, StorageStats {
  readonly deleted: string[] = [];
  readonly failKeys = new Set<string>();
  totals: BucketTotals | null = null;
  /** Shared with a repository's log to check the delete order. */
  constructor(readonly log: string[] = []) {}

  async deleteObject(key: string): Promise<void> {
    if (this.failKeys.has(key)) throw new Error(`R2 refused ${key}`);
    this.deleted.push(key);
    this.log.push(`r2:${key}`);
  }

  async bucketTotals(): Promise<BucketTotals | null> {
    return this.totals;
  }

  async prefixUsage(): Promise<{ objects: number; bytes: number }> {
    return { objects: 0, bytes: 0 };
  }
}
