import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { COLLECTIONS } from '@/server/firestore/collections';
import type { QuotaMeter } from '@/server/quota/quota-guard';
import {
  CRON_JOBS,
  type CronJob,
  type CronResultValue,
  type CronRun,
  type CronRunRepository,
  type NewCronRun,
} from '@/server/repositories/interfaces';
import { guarded } from './quota-call';

const MAX_LIMIT = 50;

const resultValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const runDoc = z.object({
  job: z.enum(CRON_JOBS),
  started_at: z.instanceof(Timestamp),
  finished_at: z.instanceof(Timestamp),
  status: z.enum(['ok', 'partial', 'error']),
  result: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((r) => {
      const out: Record<string, CronResultValue> = {};
      for (const [k, v] of Object.entries(r)) {
        const parsed = resultValue.safeParse(v);
        if (parsed.success) out[k] = parsed.data;
      }
      return out;
    }),
  error_id: z.string().nullish().catch(null).transform((v) => v ?? null),
});

/**
 * `admin_cron_runs` (Health, phase 1 step 1.7). Composite index
 * `(job, started_at desc)` serves listRecent.
 *
 * Quota: append = 1 write, always allowed (counted, never blocked: Health
 * needs it, and it is one row per cron run). listRecent = rows (min 1),
 * refused with QuotaExceededError at the read cap.
 */
export class FirestoreCronRunRepository implements CronRunRepository {
  constructor(
    private readonly db: Firestore,
    private readonly quota: QuotaMeter,
  ) {}

  async append(run: NewCronRun): Promise<string> {
    const ref = this.db.collection(COLLECTIONS.adminCronRuns).doc();
    await guarded(this.quota, () =>
      ref.set({
        job: run.job,
        started_at: Timestamp.fromDate(run.startedAt),
        finished_at: Timestamp.fromDate(run.finishedAt),
        status: run.status,
        result: run.result,
        error_id: run.errorId,
      }),
    );
    this.quota.record('writes', 1);
    return ref.id;
  }

  async listRecent(job: CronJob, limit: number): Promise<CronRun[]> {
    await this.quota.assertCan('reads');
    const n = Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
    const snap = await guarded(this.quota, () =>
      this.db
        .collection(COLLECTIONS.adminCronRuns)
        .where('job', '==', job)
        .orderBy('started_at', 'desc')
        .limit(n)
        .get(),
    );
    this.quota.record('reads', Math.max(1, snap.size));
    const runs: CronRun[] = [];
    for (const doc of snap.docs) {
      const parsed = runDoc.safeParse(doc.data());
      if (!parsed.success) continue;
      const d = parsed.data;
      runs.push({
        id: doc.id,
        job: d.job,
        startedAt: d.started_at.toDate(),
        finishedAt: d.finished_at.toDate(),
        status: d.status,
        result: d.result,
        errorId: d.error_id,
      });
    }
    return runs;
  }
}
