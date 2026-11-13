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
  /** Rollup only. */
  sessionsRolledUp: number | null;
  ipsNulled: number | null;
  stoppedAtCap: boolean;
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

/** Rollup runs near the 300 s function limit get a warning. */
export const ROLLUP_SLOW_MS = 200_000;

/** `runs` newest first. `schedule` is the Vercel cron time, for the empty message. */
export function cronCheck(runs: readonly CronRunDto[], now: number, schedule = '03:00 UTC'): CronCheck {
  const last = runs[0] ?? null;
  if (!last) return { status: 'no_data', missed: false, last: null, reason: `No run recorded yet. Runs daily at ${schedule}.` };
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

/** Rollup cron (14-health.md "Rollup cron"): ≤ 26 h and ok; Warn when slow or capped 3 nights in a row. */
export function rollupCheck(runs: readonly CronRunDto[], now: number): CronCheck {
  const last = runs[0] ?? null;
  if (!last) return { status: 'no_data', missed: false, last: null, reason: 'No run recorded yet. Runs daily at 04:00 UTC.' };
  const missed = now - Date.parse(last.startedAt) > MISSED_RUN_MS;
  if (missed) return { status: 'fail', missed, last, reason: 'No run in the last 26 hours.' };
  if (last.status === 'error') return { status: 'fail', missed, last, reason: 'The last run failed.' };
  if (runs.length >= 3 && runs.slice(0, 3).every((r) => r.stoppedAtCap)) {
    return { status: 'warn', missed, last, reason: 'Stopped at the daily cap 3 nights in a row: the backlog is growing.' };
  }
  if (last.durationMs > ROLLUP_SLOW_MS) {
    return { status: 'warn', missed, last, reason: 'The last run took over 200 s (the limit is 300 s).' };
  }
  if (last.status === 'partial') return { status: 'ok', missed, last, reason: 'Ran on time. Leftover work continues tomorrow.' };
  return { status: 'ok', missed, last, reason: 'Ran on time.' };
}
