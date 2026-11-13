import 'server-only';

import { getContainer } from '@/server/container';
import type { CronRunRepository, NewCronRun } from '@/server/repositories/interfaces';

export type CronRunRecorderDeps = {
  /** Resolved on each call, so a missing env or failed init is caught like any write error. */
  repo: () => CronRunRepository;
  logger?: Pick<Console, 'error'>;
};

/**
 * Builds `recordCronRun`: appends one `admin_cron_runs` row (Health, phase 1
 * step 1.7). Never throws and never rejects: a failed write is logged and
 * swallowed, so a cron can never fail because its record could not be kept.
 * Resolves to the row id, or null when the write failed.
 */
export function createCronRunRecorder(deps: CronRunRecorderDeps): (run: NewCronRun) => Promise<string | null> {
  const logger = deps.logger ?? console;
  return async function recordCronRun(run) {
    try {
      return await deps.repo().append(run);
    } catch (error) {
      logger.error(`[cron] could not record the ${run.job} run`, error);
      return null;
    }
  };
}

export const recordCronRun = createCronRunRecorder({ repo: () => getContainer().cronRuns });
