import type { AdminRole } from '@/server/auth/types';
import type {
  AdminUser,
  BucketTotals,
  CronJob,
  CronRun,
  CronRunRepository,
  NewCronRun,
  RoleGrant,
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

  async setDisabled(uid: string, disabled: boolean): Promise<void> {
    this.calls.push(`disabled:${uid}:${disabled}`);
    this.mustGet(uid).disabled = disabled;
  }

  async revokeSessions(uid: string): Promise<void> {
    this.mustGet(uid);
    this.calls.push(`revoke:${uid}`);
  }

  async setRole(uid: string, role: AdminRole | null, grant: RoleGrant): Promise<void> {
    this.calls.push(`role:${uid}:${role}`);
    this.mustGet(uid).role = role;
    this.calls.push(`revoke:${uid}`);
    if (role) this.roles.set(uid, { role, email: grant.email, grantedBy: grant.grantedBy, at: grant.at });
    else this.roles.delete(uid);
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
