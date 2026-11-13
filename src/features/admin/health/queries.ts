import 'server-only';

import { unstable_cache } from 'next/cache';

import { dayKey } from '@/server/analytics/model';
import { getContainer } from '@/server/container';
import { getEventRepository, getQuota } from '@/server/container-light';
import { DEFAULT_QUOTA_CAPS, QuotaExceededError } from '@/server/quota/quota-guard';
import type { CronJob, CronResultValue, CronRun } from '@/server/repositories/interfaces';
import type { CronRunDto } from './cron-status';
import type { IngestCounts, QuotaUsageDto } from './tracking-status';

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
    // Cleanup stores booleans; the rollup stores 0/1 counts.
    timeBudgetUsed: run.result.timeBudgetUsed === true || run.result.time_budget_used === 1,
    sessionsRolledUp: num(run.result.sessions_rolled_up),
    ipsNulled: num(run.result.ips_nulled),
    stoppedAtCap: run.result.stopped_at_cap === 1,
    errorId: run.errorId,
  };
}

// Errors throw out of the cache, so a failure is never cached; only rows are.
function cachedRuns(job: CronJob) {
  return unstable_cache(
    async (): Promise<CronRunDto[]> => (await getContainer().cronRuns.listRecent(job, CRON_RUNS_SHOWN)).map(toCronRunDto),
    [`admin-health-${job}-runs`],
    { tags: [HEALTH_CACHE_TAG], revalidate: 60 },
  );
}
const cachedCleanupRuns = cachedRuns('cleanup');
const cachedRollupRuns = cachedRuns('rollup');

async function runsResult(read: () => Promise<CronRunDto[]>, what: string): Promise<CronRunsResult> {
  try {
    return { state: 'ok', runs: await read(), checkedAt: Date.now() };
  } catch (error) {
    if (error instanceof QuotaExceededError) return { state: 'budget' };
    const errorId = crypto.randomUUID();
    console.error(`[admin] health: could not read ${what} ${errorId}`, error);
    return { state: 'error', errorId };
  }
}

/**
 * Last cleanup runs, newest first. Cost: ≤ 14 Firestore reads, cached 60 s
 * per server (tag `health`), counted by QuotaGuard.
 */
export function getCleanupRuns(): Promise<CronRunsResult> {
  return runsResult(cachedCleanupRuns, 'cleanup runs');
}

/** Last rollup runs, newest first. Same cost and cache as cleanup. */
export function getRollupRuns(): Promise<CronRunsResult> {
  return runsResult(cachedRollupRuns, 'rollup runs');
}

/**
 * Today's quota meters, straight from QuotaGuard (the numbers it enforces).
 * At most 1–2 reads a minute per instance. Never throws, never cached
 * (the guard keeps its own 60 s copy).
 */
export async function getQuotaUsage(): Promise<QuotaUsageDto> {
  const snap = await getQuota().usage();
  const defaultCaps = (Object.keys(DEFAULT_QUOTA_CAPS) as (keyof typeof DEFAULT_QUOTA_CAPS)[]).every(
    (k) => snap.caps[k] === DEFAULT_QUOTA_CAPS[k],
  );
  return {
    day: snap.day,
    used: snap.used,
    caps: snap.caps,
    defaultCaps,
    stoppedUntil: snap.stoppedUntil === null ? null : new Date(snap.stoppedUntil).toISOString(),
  };
}

export type TrackingHealthResult =
  | { state: 'ok'; enabled: boolean; ingest: IngestCounts }
  | { state: 'budget' }
  | { state: 'error'; errorId: string };

const DAY_MS = 86_400_000;

const cachedTrackingHealth = unstable_cache(
  async (today: string, yesterday: string): Promise<{ enabled: boolean; ingest: IngestCounts }> => {
    const events = getEventRepository();
    const [settings, a, b] = await Promise.all([
      events.readTrackingSettings(),
      events.getCounters(today, 'ingest'),
      events.getCounters(yesterday, 'ingest'),
    ]);
    const sum = (name: string) => (a[name] ?? 0) + (b[name] ?? 0);
    return {
      enabled: settings.trackingEnabled,
      ingest: { accepted: sum('accepted'), dropped: sum('dropped'), sampledOut: sum('sampled_out'), error: sum('error') },
    };
  },
  ['admin-health-tracking'],
  { tags: [HEALTH_CACHE_TAG], revalidate: 60 },
);

/**
 * Kill switch state and ingest counts for today + yesterday (UTC), as the
 * "last 24 h" window. Cost: 3 reads, cached 60 s (tag `health`).
 */
export function getTrackingHealth(): Promise<TrackingHealthResult> {
  const now = Date.now();
  const read = async (): Promise<TrackingHealthResult> => ({
    state: 'ok',
    ...(await cachedTrackingHealth(dayKey(new Date(now)), dayKey(new Date(now - DAY_MS)))),
  });
  return read().catch((error: unknown): TrackingHealthResult => {
    if (error instanceof QuotaExceededError) return { state: 'budget' };
    const errorId = crypto.randomUUID();
    console.error(`[admin] health: could not read tracking state ${errorId}`, error);
    return { state: 'error', errorId };
  });
}
