import 'server-only';

import type { AdminContext } from '@/server/auth/types';
import { ConflictError, err, ok, type Result } from '@/server/errors';
import { QuotaExceededError, type QuotaSnapshot } from '@/server/quota/quota-guard';
import type { AuditRequestInfo, AuditService } from '@/server/services/audit-service';
import { maskSubject, type DataSubject } from '@/features/admin/settings/constants';

/**
 * "Delete all data for an IP / a user" (15-settings.md "Danger zone",
 * 08-privacy.md "Export and delete on request").
 *
 * A visitor's data is the `a_sessions` docs with `ip ==` (exact) or
 * `user_id ==`; page views and clicks live inside those docs, so deleting
 * the session deletes them too. `a_hourly` / `a_daily` rollups hold no IP
 * and no uid and stay.
 *
 * Cost (Firestore free tier, through QuotaGuard):
 * - preview: 1 aggregation (`count()`, 1 read per 1,000 matches, min 1)
 *   + QuotaGuard's own usage read (≤ 1 per minute per instance)
 * - delete: the same count, then per batch of ≤ 500: 1 read per doc (min 1)
 *   + 1 delete per doc; + 1 write for the `data.delete` audit row.
 *
 * Delete cap: if the count needs more deletes (or reads) than are left today
 * the action refuses before deleting anything. While deleting, each batch is
 * sized to what is left, so the run stops with a partial result instead of
 * ever passing the cap (other instances may spend some at the same time).
 */

export type { DataSubject };

/** Storage for a subject's analytics. Firestore in production, a fake in tests. */
export interface SubjectDataStore {
  /** Matching `a_sessions` docs. Aggregation: 1 read per 1,000, min 1. */
  countSessions(subject: DataSubject): Promise<number>;
  /** Deletes up to `limit` matching docs in one batch. 1 read per doc (min 1) + 1 delete per doc. */
  deleteSessionsBatch(subject: DataSubject, limit: number): Promise<number>;
}

/** What the service needs from QuotaGuard. */
export interface QuotaBudget {
  usage(): Promise<QuotaSnapshot>;
}

/** Firestore batch limit. */
export const DELETE_BATCH = 500;
/**
 * Deletes and reads kept back from the cap: headroom for the nightly
 * retention / cleanup crons and for other instances' counts that have not
 * reached `a_counters` yet. Never spent by this tool.
 */
export const DELETE_RESERVE = 50;

export type DeletionBudget = { deletes: number; reads: number };

export type DeletionPreview = {
  subject: DataSubject;
  sessions: number;
  budget: DeletionBudget;
  /** True when today's budget covers the whole delete. */
  fits: boolean;
};

export type DeletionReport = {
  /** Sessions the count found before deleting. */
  needed: number;
  deleted: number;
  /** True when nothing matching is known to remain. */
  complete: boolean;
  /** Why it stopped early: the cap was near, or Firestore failed (logged with `errorId`). */
  stopped: 'cap' | 'error' | null;
  errorId: string | null;
};

export type DataDeletionDeps = {
  store: SubjectDataStore;
  quota: QuotaBudget;
  audit: Pick<AuditService, 'record'>;
  batchSize?: number;
  logger?: Pick<Console, 'error'>;
};

/** Reads one delete needs: the doc read in its batch query. */
function readsFor(sessions: number, batch: number): number {
  // 1 per doc, at least 1 per batch query, plus the final (possibly empty) query.
  return sessions + Math.ceil(sessions / batch) + 1;
}

export function budgetMessage(needed: number, budget: DeletionBudget): string {
  return `This needs ${needed.toLocaleString('en-US')} deletes; ${budget.deletes.toLocaleString('en-US')} are left today. Try again after 00:00 UTC.`;
}

export class DataDeletionService {
  private readonly batch: number;
  private readonly logger: Pick<Console, 'error'>;

  constructor(private readonly deps: DataDeletionDeps) {
    this.batch = Math.min(Math.max(1, deps.batchSize ?? DELETE_BATCH), DELETE_BATCH);
    this.logger = deps.logger ?? console;
  }

  /** Deletes and reads left today, minus the reserve. 0 when Firestore said RESOURCE_EXHAUSTED. */
  async budget(): Promise<DeletionBudget> {
    const usage = await this.deps.quota.usage();
    if (usage.stoppedUntil !== null) return { deletes: 0, reads: 0 };
    return {
      deletes: Math.max(0, usage.caps.deletes - usage.used.deletes - DELETE_RESERVE),
      reads: Math.max(0, usage.caps.reads - usage.used.reads - DELETE_RESERVE),
    };
  }

  /** Counts first (15-settings.md "Find data"). Throws QuotaExceededError when no read is left for the count. */
  async preview(subject: DataSubject): Promise<DeletionPreview> {
    const before = await this.budget();
    if (before.reads < 1) throw new QuotaExceededError('reads', 'cap');
    const sessions = await this.deps.store.countSessions(subject);
    const budget = await this.budget();
    return { subject, sessions, budget, fits: this.fits(sessions, budget) };
  }

  /**
   * Counts again (the preview may be stale), refuses if today's budget cannot
   * cover it, then deletes in batches and writes one `data.delete` row with
   * the counts and a masked target. Nothing found → nothing deleted, no row.
   */
  async deleteSubject(
    ctx: AdminContext,
    subject: DataSubject,
    opts: { request?: AuditRequestInfo } = {},
  ): Promise<Result<DeletionReport>> {
    const start = await this.budget();
    if (start.reads < 1) throw new QuotaExceededError('reads', 'cap');
    const needed = await this.deps.store.countSessions(subject);
    if (needed === 0) return ok({ needed: 0, deleted: 0, complete: true, stopped: null, errorId: null });

    let budget = await this.budget();
    if (!this.fits(needed, budget)) return err(new ConflictError(budgetMessage(needed, budget)));

    let deleted = 0;
    let complete = false;
    let stopped: DeletionReport['stopped'] = null;
    let errorId: string | null = null;
    try {
      while (deleted < needed) {
        // Never more than is left: each doc costs 1 delete and 1 read, the query at least 1 read.
        const room = Math.min(budget.deletes, budget.reads - 1, needed - deleted, this.batch);
        if (room <= 0) {
          stopped = 'cap';
          break;
        }
        const n = await this.deps.store.deleteSessionsBatch(subject, room);
        deleted += n;
        if (n < room) {
          complete = true; // fewer left than asked for: none remain
          break;
        }
        budget = await this.budget();
      }
      if (deleted >= needed) complete = true;
    } catch (error) {
      stopped = 'error';
      errorId = crypto.randomUUID();
      const code = (error as { code?: unknown; name?: unknown } | null) ?? {};
      // Name and code only: a Firestore message can hold a doc path or the IP.
      this.logger.error(`[settings] data delete failed ${errorId}`, String(code.name ?? 'Error'), String(code.code ?? ''));
    }

    if (deleted > 0) {
      await this.deps.audit.record({
        ctx,
        action: 'data.delete',
        target: { type: subject.kind, id: maskSubject(subject) },
        before: { sessions: needed },
        after: { sessions_deleted: deleted, complete, stopped },
        request: opts.request,
      });
    }
    return ok({ needed, deleted, complete, stopped, errorId });
  }

  private fits(sessions: number, budget: DeletionBudget): boolean {
    return sessions <= budget.deletes && readsFor(sessions, this.batch) <= budget.reads;
  }
}
