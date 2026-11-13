import 'server-only';

import { unstable_cache } from 'next/cache';

import { getContainer } from '@/server/container';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import type { CronResultValue, CronRun } from '@/server/repositories/interfaces';
import type { CronRunDto } from './cron-status';

/** Rows shown on Health (the "last 14 runs" list). */
export const CRON_RUNS_SHOWN = 14;
export const HEALTH_CACHE_TAG = 'health';

export type CronRunsResult =
  /** `checkedAt`: epoch ms of this request, for the run age (render must stay pure). */
  | { state: 'ok'; runs: CronRunDto[]; checkedAt: number }
  /** Read budget used up for today (QuotaGuard). */
  | { state: 'budget' }
  | { state: 'error'; errorId: string };

function num(value: CronResultValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function toCronRunDto(run: CronRun): CronRunDto {
  return {
    id: run.id,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    durationMs: Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime()),
    status: run.status,
    filesDeleted: num(run.result.filesDeleted),
    roomsDeleted: num(run.result.roomsDeleted),
    sessionsDeleted: num(run.result.sessionsDeleted),
    filesFailed: num(run.result.filesFailed),
    timeBudgetUsed: run.result.timeBudgetUsed === true,
    errorId: run.errorId,
  };
}

// Errors throw out of the cache, so a failure is never cached; only rows are.
const cachedCleanupRuns = unstable_cache(
  async (): Promise<CronRunDto[]> =>
    (await getContainer().cronRuns.listRecent('cleanup', CRON_RUNS_SHOWN)).map(toCronRunDto),
  ['admin-health-cleanup-runs'],
  { tags: [HEALTH_CACHE_TAG], revalidate: 60 },
);

/**
 * Last cleanup runs, newest first. Cost: ≤ 14 Firestore reads, cached 60 s
 * per server (tag `health`), counted by QuotaGuard.
 */
export async function getCleanupRuns(): Promise<CronRunsResult> {
  try {
    return { state: 'ok', runs: await cachedCleanupRuns(), checkedAt: Date.now() };
  } catch (error) {
    if (error instanceof QuotaExceededError) return { state: 'budget' };
    const errorId = crypto.randomUUID();
    console.error(`[admin] health: could not read cron runs ${errorId}`, error);
    return { state: 'error', errorId };
  }
}
