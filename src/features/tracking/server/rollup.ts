import 'server-only';

import {
  addRollup,
  dayKey,
  emptyRollup,
  foldRollup,
  hourKey,
  hoursOfDay,
  rollupHour,
  sessionRollup,
  type Rollup,
} from '@/server/analytics/model';
import type { QuotaKind, QuotaMeter } from '@/server/quota/quota-guard';
import type { EventRepository } from '@/server/repositories/interfaces';

/**
 * Nightly rollup and retention (one cron run, triggered by
 * /api/admin/cron/rollup). Steps, in order:
 * 1. Catch-up: sessions with `rolled_up == false` last seen > 30 min ago
 *    (no final flush: mobile kill, crash) → `a_hourly`, `rolled_up = true`.
 * 2. `a_daily` for the last 2 complete UTC days, rebuilt by overwrite from
 *    their 24 `a_hourly` docs (idempotent). Long-tail map keys fold into `_other`.
 * 3. Retention: delete `a_sessions` past the raw window (90 d), null full
 *    IPs past the IP window (30 d, 1 write each), delete `a_hourly` (14 d)
 *    and `a_counters` (1 y). Batches of 500. Windows from settings.
 *
 * QuotaGuard is asked before every Firestore call. At the write cap the
 * writes stop; at the delete cap the deletes stop; the next night continues.
 * No TTL policy (not free on Spark).
 *
 * Firestore cost per run, roughly: catch-up 1 read + 2 writes per session;
 * daily 48 reads + 2 writes; retention 1 read + 1 write/delete per doc, plus
 * 1 read per empty query (≤ 5) and 1 settings read.
 */

export const CATCH_UP_AFTER_MS = 30 * 60_000;
export const CATCH_UP_PAGE = 100;
export const BATCH = 500;
export const HOURLY_KEEP_DAYS = 14;
export const COUNTERS_KEEP_DAYS = 365;
/** Same work budget as /api/cleanup, inside a 60 s maxDuration. */
export const BUDGET_MS = 45_000;

const DAY_MS = 86_400_000;

export type RollupCounts = {
  sessions_rolled_up: number;
  daily_built: number;
  ips_nulled: number;
  sessions_deleted: number;
  hourly_deleted: number;
  counters_deleted: number;
  /** 1 when a write or delete cap stopped the run. */
  stopped_at_cap: number;
  /** 1 when the time budget ended the run. */
  time_budget_used: number;
};

export type RollupResult = { status: 'ok' | 'partial' | 'failed'; counts: RollupCounts; error: string | null };

export type CronRun = {
  job: string;
  startedAt: Date;
  endedAt: Date;
  status: 'ok' | 'partial' | 'failed';
  counts: Record<string, number>;
  error?: string | null;
};

export type RollupDeps = {
  events: EventRepository;
  /** `flush` (QuotaGuard) writes the run's counted operations at the end. */
  quota: QuotaMeter & { flush?: () => Promise<void> };
  recordCronRun: (run: CronRun) => Promise<void>;
  now?: () => number;
  budgetMs?: number;
  logger?: Pick<Console, 'error'>;
};

class StopRun extends Error {
  constructor(readonly reason: 'cap' | 'time') {
    super(reason);
  }
}

export class RollupService {
  private readonly now: () => number;
  private readonly budgetMs: number;
  private readonly logger: Pick<Console, 'error'>;

  constructor(private readonly deps: RollupDeps) {
    this.now = deps.now ?? Date.now;
    this.budgetMs = deps.budgetMs ?? BUDGET_MS;
    this.logger = deps.logger ?? console;
  }

  /** One full run. Never throws; records exactly one cron run. */
  async run(): Promise<RollupResult> {
    const startedAt = new Date(this.now());
    const deadline = startedAt.getTime() + this.budgetMs;
    const counts: RollupCounts = {
      sessions_rolled_up: 0,
      daily_built: 0,
      ips_nulled: 0,
      sessions_deleted: 0,
      hourly_deleted: 0,
      counters_deleted: 0,
      stopped_at_cap: 0,
      time_budget_used: 0,
    };
    let status: RollupResult['status'] = 'ok';
    let error: string | null = null;

    // Each step stops on its own cap; a time stop ends the run.
    const step = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        if (!(e instanceof StopRun)) throw e;
        if (e.reason === 'cap') counts.stopped_at_cap = 1;
        else {
          counts.time_budget_used = 1;
          throw e;
        }
      }
    };
    const ctx = { deadline, counts };

    try {
      await step(() => this.catchUp(ctx));
      await step(() => this.buildRecentDays(ctx));
      await step(() => this.retention(ctx));
    } catch (e) {
      if (!(e instanceof StopRun)) {
        status = 'failed';
        error = e instanceof Error ? e.message : String(e);
        this.logger.error('[rollup] run failed', e);
      }
    }
    if (status === 'ok' && (counts.stopped_at_cap || counts.time_budget_used)) status = 'partial';

    await this.deps.quota.flush?.().catch(() => {});
    try {
      await this.deps.recordCronRun({
        job: 'rollup',
        startedAt,
        endedAt: new Date(this.now()),
        status,
        counts: { ...counts },
        error,
      });
    } catch (e) {
      this.logger.error('[rollup] could not record the cron run', e);
    }
    return { status, counts, error };
  }

  /** Rebuilds `a_daily/{day}` from its `a_hourly` docs (backfill: any day still within 14 days). */
  async buildDaily(day: string): Promise<boolean> {
    await this.require('reads');
    await this.require('writes');
    const hours = await this.deps.events.getHourly(hoursOfDay(day));
    const present = hours.filter((h): h is Rollup => h !== null);
    // No hourly docs: nothing to build, and never overwrite a daily whose hours were deleted.
    if (present.length === 0) return false;
    const total = present.reduce((sum, h) => addRollup(sum, h), emptyRollup());
    await this.deps.events.putDaily({ ...foldRollup(total), day, built_at: new Date(this.now()) });
    return true;
  }

  private async require(kind: QuotaKind): Promise<void> {
    if ((await this.deps.quota.canWrite(kind)) === 'stop') throw new StopRun('cap');
  }

  private checkTime(deadline: number): void {
    if (this.now() >= deadline) throw new StopRun('time');
  }

  private async catchUp({ deadline, counts }: { deadline: number; counts: RollupCounts }): Promise<void> {
    const before = new Date(this.now() - CATCH_UP_AFTER_MS);
    for (;;) {
      this.checkTime(deadline);
      await this.require('reads');
      const sessions = await this.deps.events.listUnrolledSessions(before, CATCH_UP_PAGE);
      for (const session of sessions) {
        this.checkTime(deadline);
        await this.require('writes');
        await this.deps.events.rollUpSession(session.id, { hour: rollupHour(session), delta: sessionRollup(session) });
        counts.sessions_rolled_up += 1;
      }
      if (sessions.length < CATCH_UP_PAGE) return;
    }
  }

  private async buildRecentDays({ deadline, counts }: { deadline: number; counts: RollupCounts }): Promise<void> {
    const today = Date.parse(`${dayKey(new Date(this.now()))}T00:00:00Z`);
    for (const offset of [2, 1]) {
      this.checkTime(deadline);
      if (await this.buildDaily(dayKey(new Date(today - offset * DAY_MS)))) counts.daily_built += 1;
    }
  }

  private async retention({ deadline, counts }: { deadline: number; counts: RollupCounts }): Promise<void> {
    const { events } = this.deps;
    await this.require('reads');
    const settings = await events.readTrackingSettings();
    const now = this.now();

    let capHit = false;
    // Runs `batch` until it returns less than a full batch, the kind's cap, or the deadline.
    const drain = async (kind: QuotaKind, batch: () => Promise<number>, add: (n: number) => void) => {
      for (;;) {
        this.checkTime(deadline);
        if ((await this.deps.quota.canWrite('reads')) === 'stop' || (await this.deps.quota.canWrite(kind)) === 'stop') {
          capHit = true;
          return false;
        }
        const n = await batch();
        add(n);
        if (n < BATCH) return true;
      }
    };

    const ipCutoff = new Date(now - settings.ipRetentionDays * DAY_MS);
    const steps: [QuotaKind, () => Promise<number>, (n: number) => void][] = [
      // Expired sessions go first, so their IPs are not nulled (1 write each) just before the delete.
      ['deletes', () => events.deleteSessions(new Date(now - settings.rawRetentionDays * DAY_MS), BATCH), (n) => (counts.sessions_deleted += n)],
      ['writes', () => events.nullIps(ipCutoff, BATCH), (n) => (counts.ips_nulled += n)],
      ['deletes', () => events.deleteHourly(hourKey(new Date(now - HOURLY_KEEP_DAYS * DAY_MS)), BATCH), (n) => (counts.hourly_deleted += n)],
      ['deletes', () => events.deleteCounters(dayKey(new Date(now - COUNTERS_KEEP_DAYS * DAY_MS)), BATCH), (n) => (counts.counters_deleted += n)],
    ];
    // Each kind stops at its own cap: a delete stop ends the deletes for the
    // night, while IP nulling (writes) still runs, and the other way round.
    const stopped = new Set<QuotaKind>();
    for (const [kind, batch, add] of steps) {
      if (stopped.has(kind)) continue;
      if (!(await drain(kind, batch, add))) stopped.add(kind);
    }
    if (capHit) throw new StopRun('cap');
  }
}
