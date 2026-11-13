// Pure status rules for the cron rows on Health (docs/admin/03-features/14-health.md
// "Checks"). No server or React imports, so tests and client code can use it.

/** A cron run as the page sees it (JSON safe). */
export type CronRunDto = {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'ok' | 'partial' | 'error';
  filesDeleted: number | null;
  roomsDeleted: number | null;
  sessionsDeleted: number | null;
  filesFailed: number | null;
  timeBudgetUsed: boolean;
  errorId: string | null;
};

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'no_data';

export type CronCheck = {
  status: CheckStatus;
  /** The last run is older than MISSED_RUN_MS. */
  missed: boolean;
  last: CronRunDto | null;
  /** Plain words for the status. */
  reason: string;
};

/** Daily cron + room for Vercel Hobby timing drift. */
export const MISSED_RUN_MS = 26 * 60 * 60_000;

/** `runs` newest first. */
export function cronCheck(runs: readonly CronRunDto[], now: number): CronCheck {
  const last = runs[0] ?? null;
  if (!last) return { status: 'no_data', missed: false, last: null, reason: 'No run recorded yet. Runs daily at 03:00 UTC.' };
  const age = now - Date.parse(last.startedAt);
  const missed = age > MISSED_RUN_MS;
  if (missed) return { status: 'fail', missed, last, reason: 'No run in the last 26 hours.' };
  if (last.status === 'error') return { status: 'fail', missed, last, reason: 'The last run failed.' };
  if (last.status === 'partial') return { status: 'warn', missed, last, reason: 'The last run finished with errors.' };
  if ((last.filesFailed ?? 0) > 0) return { status: 'warn', missed, last, reason: 'Some files could not be deleted.' };
  if (last.timeBudgetUsed && runs[1]?.timeBudgetUsed) {
    return { status: 'warn', missed, last, reason: 'Two runs in a row hit the time budget: the backlog is growing.' };
  }
  return { status: 'ok', missed, last, reason: 'Ran on time.' };
}
