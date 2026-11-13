import 'server-only';

import type { AdminRole } from '@/server/auth/types';
import type { DailyDoc, Rollup, SessionDoc, SessionPatch, TrackingSettings } from '@/server/analytics/model';

/** Every action the audit log knows. Catalogue: docs 03-features/11-audit-log.md. */
export const AUDIT_ACTIONS = [
  'auth.sign_in',
  'auth.sign_out',
  'auth.denied',
  'auth.step_up',
  'block.create',
  'block.update',
  'block.remove',
  'block.restore',
  'file.delete',
  'storage.orphan_scan',
  'room.close',
  'user.disable',
  'user.enable',
  'user.revoke_sessions',
  'role.set',
  'settings.update',
  'analytics.delete',
  'export.csv',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** JSON-safe map stored in `before` / `after`. */
export type AuditData = Record<string, unknown>;

/** One row as the caller hands it to the repository (`at` and `id` are set by the store). */
export type NewAuditEntry = {
  actorUid: string | null;
  actorEmail: string | null;
  /** `null` for denied users who hold no role. */
  actorRole: AdminRole | null;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  before: AuditData | null;
  after: AuditData | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
};

export type AuditEntry = NewAuditEntry & { id: string; at: Date };

/**
 * Filters map one-to-one to the composite indexes on `admin_audit`:
 * none, actorUid, action, targetId, or actorUid + action. Other combinations
 * have no index and fail on real Firestore.
 */
export type AuditListQuery = {
  actorUid?: string;
  action?: AuditAction;
  targetId?: string;
  /** Inclusive lower bound on `at`. */
  from?: Date;
  /** Exclusive upper bound on `at`. */
  to?: Date;
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string | null;
  limit: number;
};

export type AuditPage = { entries: AuditEntry[]; nextCursor: string | null };

/**
 * Append-only by design (T-23): there is no update or delete method, and a
 * type test fails if one is added. Only the retention cron may delete rows,
 * through its own class.
 */
export interface AuditRepository {
  /** Writes one row and returns its id. Throws if the write fails. */
  append(entry: NewAuditEntry): Promise<string>;
  /**
   * Writes one row under a caller-chosen id, only if no row has that id yet.
   * Never overwrites: returns `true` when written, `false` when the id was
   * already taken (the stored row is left as it was). Throws on any other
   * failure. Used for "once per X" rows such as `auth.sign_in` per session.
   */
  appendOnce(id: string, entry: NewAuditEntry): Promise<boolean>;
  /** Newest first (`at` desc, then id desc), cursor paged. */
  list(query: AuditListQuery): Promise<AuditPage>;
}

// ---------------------------------------------------------------------------
// Tracking (phase 2): a_sessions, a_hourly, a_daily, a_counters, and the
// tracking part of admin_config/settings. Docs and maths: server/analytics/model.ts.
// ---------------------------------------------------------------------------

/** Rollup increments for one `a_hourly` doc. */
export type HourlyIncrement = { hour: string; delta: Rollup };

/**
 * Storage for visitor analytics. Firestore in production, in-memory in unit
 * tests; one contract test runs on both. The Firestore implementation reports
 * every read, write and delete to QuotaGuard; callers ask QuotaGuard first.
 */
export interface EventRepository {
  /** The tracking fields of `admin_config/settings`. Missing doc or field = code defaults (tracking off). */
  readTrackingSettings(): Promise<TrackingSettings>;
  getSession(id: string): Promise<SessionDoc | null>;
  /**
   * One flush: a single `set/merge` on `a_sessions/{id}`. With `hourly`, the
   * same batch also increments that `a_hourly` doc (the final flush).
   */
  writeSession(patch: SessionPatch, hourly?: HourlyIncrement | null): Promise<void>;
  /** Sessions with `rolled_up == false` last seen before `seenBefore`, oldest first. */
  listUnrolledSessions(seenBefore: Date, limit: number): Promise<SessionDoc[]>;
  /** One batch: increments `a_hourly/{hour}` and sets `rolled_up: true` on the session. */
  rollUpSession(id: string, hourly: HourlyIncrement): Promise<void>;
  /** `a_hourly` docs in the order asked; `null` where missing. */
  getHourly(hours: string[]): Promise<(Rollup | null)[]>;
  /** Overwrites `a_daily/{day}` (idempotent). */
  putDaily(doc: DailyDoc): Promise<void>;
  getDaily(day: string): Promise<DailyDoc | null>;
  /** Sets `ip` to null on up to `limit` sessions last seen before `seenBefore`. Returns how many. */
  nullIps(seenBefore: Date, limit: number): Promise<number>;
  /** Deletes up to `limit` sessions last seen before `seenBefore`. Returns how many. */
  deleteSessions(seenBefore: Date, limit: number): Promise<number>;
  /** Deletes up to `limit` `a_hourly` docs with an id before `beforeHour`. */
  deleteHourly(beforeHour: string, limit: number): Promise<number>;
  /** Deletes up to `limit` `a_counters` docs with an id before `beforeDay`. */
  deleteCounters(beforeDay: string, limit: number): Promise<number>;
  /** One write: increments `a_counters/{day}.{group}.{name}` by each delta. */
  incrementCounters(day: string, group: string, delta: Record<string, number>): Promise<void>;
  getCounters(day: string, group: string): Promise<Record<string, number>>;
}
