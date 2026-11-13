import 'server-only';

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { ADMIN_CONFIG_DOCS, COLLECTIONS } from '@/server/firestore/collections';

/**
 * QuotaGuard: the one gate for the admin + tracker share of the Firestore
 * free quota (hard rule 8). Chat never goes through it, so chat can never be
 * stopped by it. Spec: docs/admin/01-architecture/03-data-model.md
 * ("How QuotaGuard enforces the caps").
 *
 * Firestore cost of the guard itself, per server instance:
 * - 1 read of a_counters/{day} at most every 60 s, only while something asks
 *   canWrite(); +1 read of admin_config/settings at most every 5 min.
 * - 1 write (one FieldValue.increment set) at most every 5 min, or after 200
 *   counted operations, only while there is something to flush.
 */

export type QuotaKind = 'reads' | 'writes' | 'deletes';
export type QuotaDecision = 'ok' | 'sample' | 'stop';
export type QuotaCounts = Record<QuotaKind, number>;
export type QuotaCaps = QuotaCounts;

export const DEFAULT_QUOTA_CAPS: Readonly<QuotaCaps> = { reads: 10_000, writes: 5_000, deletes: 5_000 };
/** Share of the write cap at which new tracker sessions are sampled 1 in 2. */
export const SAMPLE_THRESHOLD = 0.7;
export const FLUSH_INTERVAL_MS = 5 * 60_000;
export const FLUSH_EVENT_COUNT = 200;
export const USAGE_REFRESH_MS = 60_000;
export const CAPS_REFRESH_MS = 5 * 60_000;
/** Firestore's free quota resets at midnight in this zone. */
export const QUOTA_RESET_TIME_ZONE = 'America/Los_Angeles';

/** Thrown by `assertCan` when a kind is stopped for the day. */
export class QuotaExceededError extends Error {
  readonly kind: QuotaKind;
  /** `cap`: our own daily cap is used up. `exhausted`: Firestore said RESOURCE_EXHAUSTED. */
  readonly reason: 'cap' | 'exhausted';

  constructor(kind: QuotaKind, reason: 'cap' | 'exhausted') {
    super(
      reason === 'cap'
        ? `Firestore ${kind} budget for admin and tracking is used up for today`
        : 'Firestore quota exhausted; admin and tracking paused until midnight Pacific',
    );
    this.name = 'QuotaExceededError';
    this.kind = kind;
    this.reason = reason;
  }
}

/** What a Firestore repository needs from the guard (interface segregation). */
export interface QuotaMeter {
  /** Count operations that already happened. Never blocks, never throws. */
  record(kind: QuotaKind, count?: number): void;
  /** Ask before an operation that may be skipped or degraded. */
  canWrite(kind: QuotaKind): Promise<QuotaDecision>;
  /** Like canWrite, but throws QuotaExceededError on 'stop'. */
  assertCan(kind: QuotaKind): Promise<QuotaDecision>;
  /** Feed every Firestore error here. Returns true if it set the stop flag. */
  noteError(error: unknown): boolean;
}

/** Storage behind the guard. Firestore in production, a fake in tests. */
export interface QuotaStore {
  /** Reads a_counters/{day} and, when `withCaps`, admin_config/settings in the same call. */
  read(day: string, withCaps: boolean): Promise<{ used: QuotaCounts; caps: Partial<QuotaCaps> | null }>;
  /** One write: increments a_counters/{day} by `delta`. */
  add(day: string, delta: QuotaCounts): Promise<void>;
}

export type QuotaGuardOptions = {
  now?: () => number;
  logger?: Pick<Console, 'warn'>;
};

export type QuotaSnapshot = {
  day: string;
  used: QuotaCounts;
  caps: QuotaCaps;
  /** Epoch ms until which the RESOURCE_EXHAUSTED stop flag holds, or null. */
  stoppedUntil: number | null;
};

const KINDS: readonly QuotaKind[] = ['reads', 'writes', 'deletes'];

function zero(): QuotaCounts {
  return { reads: 0, writes: 0, deletes: 0 };
}

function total(c: QuotaCounts): number {
  return c.reads + c.writes + c.deletes;
}

/** UTC day key for a_counters, e.g. `2026-11-13`. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Aggregation queries (count, sum) bill 1 read per 1,000 index entries, minimum 1. */
export function readsForAggregation(indexEntries: number): number {
  return Math.max(1, Math.ceil(indexEntries / 1000));
}

export function isResourceExhausted(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  // gRPC status 8 (Admin SDK) or the client SDK's string code.
  if (code === 8 || code === 'resource-exhausted' || code === 'RESOURCE_EXHAUSTED') return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('RESOURCE_EXHAUSTED');
}

const zoneFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: QUOTA_RESET_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

function zoneParts(ms: number): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number> {
  const parts: Record<string, number> = {};
  for (const p of zoneFormat.formatToParts(ms)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Zone offset in ms at instant `ms` (negative for Pacific). */
function zoneOffset(ms: number): number {
  const p = zoneParts(ms);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** The next 00:00 in America/Los_Angeles after `ms`, as epoch ms. DST safe. */
export function nextPacificMidnight(ms: number): number {
  const p = zoneParts(ms);
  const wallMidnight = Date.UTC(p.year, p.month - 1, p.day + 1);
  const guess = wallMidnight - zoneOffset(wallMidnight);
  return wallMidnight - zoneOffset(guess);
}

const counterValue = z.number().nonnegative().catch(0);
const countersDoc = z.object({
  reads_used: counterValue,
  writes_used: counterValue,
  deletes_used: counterValue,
});

const capValue = z.number().positive().optional().catch(undefined);
const settingsDoc = z.object({
  quota: z
    .object({ reads_cap: capValue, writes_cap: capValue, deletes_cap: capValue })
    .optional()
    .catch(undefined),
});

/** Firestore storage for the guard: a_counters/{day} and admin_config/settings.quota. */
export class FirestoreQuotaStore implements QuotaStore {
  constructor(private readonly db: Firestore) {}

  async read(day: string, withCaps: boolean) {
    const countersRef = this.db.collection(COLLECTIONS.aCounters).doc(day);
    if (!withCaps) {
      const snap = await countersRef.get();
      return { used: parseCounters(snap.data()), caps: null };
    }
    const settingsRef = this.db.collection(COLLECTIONS.adminConfig).doc(ADMIN_CONFIG_DOCS.settings);
    const [counters, settings] = await this.db.getAll(countersRef, settingsRef);
    const quota = settingsDoc.parse(settings.data() ?? {}).quota;
    return {
      used: parseCounters(counters.data()),
      caps: quota ? { reads: quota.reads_cap, writes: quota.writes_cap, deletes: quota.deletes_cap } : null,
    };
  }

  async add(day: string, delta: QuotaCounts) {
    const update: Record<string, FieldValue> = {};
    for (const kind of KINDS) {
      if (delta[kind] > 0) update[`${kind}_used`] = FieldValue.increment(delta[kind]);
    }
    if (Object.keys(update).length === 0) return;
    await this.db.collection(COLLECTIONS.aCounters).doc(day).set(update, { merge: true });
  }
}

function parseCounters(data: unknown): QuotaCounts {
  const doc = countersDoc.parse(data ?? {});
  return { reads: doc.reads_used, writes: doc.writes_used, deletes: doc.deletes_used };
}

export class QuotaGuard implements QuotaMeter {
  private readonly now: () => number;
  private readonly logger: Pick<Console, 'warn'>;

  /** Unflushed counts per UTC day (normally one entry). */
  private pending = new Map<string, QuotaCounts>();
  private eventsSinceFlush = 0;
  private lastFlushAt: number;
  private flushing: Promise<void> | null = null;

  private usageDay: string | null = null;
  private remoteUsed: QuotaCounts = zero();
  /** Counts this instance flushed after the last remote read (not in remoteUsed yet). */
  private flushedSinceRead: QuotaCounts = zero();
  private usageReadAt = Number.NEGATIVE_INFINITY;
  private caps: QuotaCaps = { ...DEFAULT_QUOTA_CAPS };
  private capsReadAt = Number.NEGATIVE_INFINITY;
  private refreshing: Promise<void> | null = null;

  private stopUntil = 0;

  constructor(
    private readonly store: QuotaStore,
    options: QuotaGuardOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? console;
    this.lastFlushAt = this.now();
  }

  record(kind: QuotaKind, count = 1): void {
    const n = Math.ceil(count);
    if (!(n > 0)) return;
    const day = utcDay(this.now());
    const counts = this.pending.get(day) ?? zero();
    counts[kind] += n;
    this.pending.set(day, counts);
    this.eventsSinceFlush += n;
    if (this.flushDue()) void this.flush();
  }

  async canWrite(kind: QuotaKind): Promise<QuotaDecision> {
    if (this.isStopped()) return 'stop';
    await this.refreshIfStale();
    if (this.isStopped()) return 'stop';
    const used = this.used(kind, utcDay(this.now()));
    const cap = this.caps[kind];
    if (used >= cap) return 'stop';
    if (kind === 'writes' && used >= cap * SAMPLE_THRESHOLD) return 'sample';
    return 'ok';
  }

  async assertCan(kind: QuotaKind): Promise<QuotaDecision> {
    const decision = await this.canWrite(kind);
    if (decision === 'stop') {
      throw new QuotaExceededError(kind, this.isStopped() ? 'exhausted' : 'cap');
    }
    return decision;
  }

  noteError(error: unknown): boolean {
    if (!isResourceExhausted(error)) return false;
    const until = nextPacificMidnight(this.now());
    if (until > this.stopUntil) {
      this.stopUntil = until;
      this.logger.warn(
        `[quota] RESOURCE_EXHAUSTED: admin and tracking writes stop on this instance until ${new Date(until).toISOString()}`,
      );
    }
    return true;
  }

  /**
   * Writes the unflushed counts now (one increment per day with counts).
   * Never throws: on failure the counts stay pending for the next flush.
   * Call it from `after()` at the end of a request that did a lot of work.
   */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.isStopped() || this.pending.size === 0) return Promise.resolve();
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /**
   * Today's usage and caps for Health: the same numbers `canWrite` decides
   * on. Reads `a_counters` at most once a minute per instance. Never throws.
   */
  async usage(): Promise<QuotaSnapshot> {
    await this.refreshIfStale();
    return this.snapshot();
  }

  snapshot(): QuotaSnapshot {
    const day = utcDay(this.now());
    const used = zero();
    for (const kind of KINDS) used[kind] = this.used(kind, day);
    return { day, used, caps: { ...this.caps }, stoppedUntil: this.isStopped() ? this.stopUntil : null };
  }

  private isStopped(): boolean {
    return this.now() < this.stopUntil;
  }

  private flushDue(): boolean {
    if (this.flushing || this.pending.size === 0 || this.isStopped()) return false;
    return this.eventsSinceFlush >= FLUSH_EVENT_COUNT || this.now() - this.lastFlushAt >= FLUSH_INTERVAL_MS;
  }

  private used(kind: QuotaKind, day: string): number {
    const local = this.pending.get(day)?.[kind] ?? 0;
    if (this.usageDay !== day) return local;
    return this.remoteUsed[kind] + this.flushedSinceRead[kind] + local;
  }

  private async doFlush(): Promise<void> {
    const batch = this.pending;
    this.pending = new Map();
    this.eventsSinceFlush = 0;
    this.lastFlushAt = this.now();

    for (const [day, delta] of batch) {
      if (total(delta) === 0) continue;
      try {
        await this.store.add(day, delta);
        if (day === this.usageDay) {
          for (const kind of KINDS) this.flushedSinceRead[kind] += delta[kind];
        }
        // The flush is itself a write: count it (always allowed).
        this.addPending(utcDay(this.now()), { reads: 0, writes: 1, deletes: 0 });
      } catch (error) {
        this.noteError(error);
        this.logger.warn('[quota] counter flush failed; counts kept for the next flush', error);
        this.restorePending(day, delta);
      }
    }
  }

  /** Puts counts back after a failed flush. Drops days older than yesterday. */
  private restorePending(day: string, delta: QuotaCounts): void {
    const yesterday = utcDay(this.now() - 86_400_000);
    if (day < yesterday) return;
    this.addPending(day, delta);
  }

  private addPending(day: string, delta: QuotaCounts): void {
    const counts = this.pending.get(day) ?? zero();
    for (const kind of KINDS) counts[kind] += delta[kind];
    this.pending.set(day, counts);
  }

  private refreshIfStale(): Promise<void> {
    const now = this.now();
    const day = utcDay(now);
    if (this.usageDay === day && now - this.usageReadAt < USAGE_REFRESH_MS) return Promise.resolve();
    if (!this.refreshing) {
      this.refreshing = this.refresh(day, now).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async refresh(day: string, now: number): Promise<void> {
    const withCaps = now - this.capsReadAt >= CAPS_REFRESH_MS;
    let result: Awaited<ReturnType<QuotaStore['read']>> | null = null;
    try {
      result = await this.store.read(day, withCaps);
    } catch (error) {
      this.noteError(error);
      this.logger.warn('[quota] usage read failed; using the last known counts', error);
    }
    // Set even on failure, so a failing read is retried at most every 60 s.
    this.usageReadAt = now;
    if (result) {
      this.usageDay = day;
      this.remoteUsed = result.used;
      this.flushedSinceRead = zero();
      if (withCaps) {
        this.caps = {
          reads: result.caps?.reads ?? DEFAULT_QUOTA_CAPS.reads,
          writes: result.caps?.writes ?? DEFAULT_QUOTA_CAPS.writes,
          deletes: result.caps?.deletes ?? DEFAULT_QUOTA_CAPS.deletes,
        };
        this.capsReadAt = now;
      }
      // The guard's own reads count, but are never blocked.
      this.record('reads', withCaps ? 2 : 1);
    } else if (this.usageDay !== day) {
      // New day and no data yet: start from this instance's own counts.
      this.usageDay = day;
      this.remoteUsed = zero();
      this.flushedSinceRead = zero();
    }
  }
}
