import { timingSafeEqual } from 'crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import {
  deleteExpiredReceiveSessions,
  deleteFile as fsDeleteFile,
  listExpiredAnonymousFiles,
} from '@/shared/lib/firebase/files';
import { deleteExpiredRooms } from '@/shared/lib/firebase/chat';
import { deleteObject } from '@/shared/lib/r2';
import { getBlocks } from '@/server/container';
import { recordCronRun } from '@/server/cron/record-cron-run';
import { cronRoomHooks, sweepRoomHistory } from '@/server/rooms/room-history';
import type { CronResultValue, CronRunStatus } from '@/server/repositories/interfaces';

export const runtime = 'nodejs';
// Never cache: every cron call must run the cleanup.
export const dynamic = 'force-dynamic';
// Room for the 45s work budget below plus the batch that is running when it
// ends. Without it, a plan with a 10s default would cut a backlog run short.
export const maxDuration = 60;

// One run keeps deleting batches until nothing is left or this much time has
// passed; whatever remains is picked up by the next run.
const BUDGET_MS = 45_000;
const FILE_BATCH = 100;
const FILE_PARALLEL = 10;
const SESSION_BATCH = 500;

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET
 * env var is set. Without that variable the route refuses every call
 * (fail closed), so nobody else can trigger deletes.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * One `admin_cron_runs` row per run, written after the response (Health).
 * recordCronRun never throws, and scheduling is guarded too, so the record
 * can never fail or slow the cleanup.
 */
function reportRun(status: CronRunStatus, startedAt: Date, result: Record<string, CronResultValue>, errorId: string | null) {
  const run = { job: 'cleanup' as const, startedAt, finishedAt: new Date(), status, result, errorId };
  try {
    after(() => recordCronRun(run));
  } catch (err) {
    console.error('Cleanup run record could not be scheduled:', err);
  }
}

// Vercel Cron calls GET. POST stays for manual runs and scripts/e2e-cleanup.mjs.
export const GET = runCleanup;
export const POST = runCleanup;

async function runCleanup(request: NextRequest) {
  if (!isAuthorized(request)) {
    if (!process.env.CRON_SECRET) console.error('Cleanup refused: CRON_SECRET is not set.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();
  try {
    const deadline = Date.now() + BUDGET_MS;
    const hasTime = () => Date.now() < deadline;

    // Expired receive sessions: cheap, one batch write each round.
    let sessionsDeleted = 0;
    let n: number;
    do {
      n = await deleteExpiredReceiveSessions(SESSION_BATCH);
      sessionsDeleted += n;
    } while (n === SESSION_BATCH && hasTime());

    // Expired guest files: R2 object first, then the record. A file that
    // fails is skipped for the rest of this run so it can't stall the loop.
    let filesDeleted = 0;
    const seen = new Set<string>();
    const failed = new Set<string>();
    while (hasTime()) {
      const batch = (await listExpiredAnonymousFiles(FILE_BATCH)).filter((f) => !failed.has(f.token));
      if (batch.length === 0) break;
      for (let i = 0; i < batch.length && hasTime(); i += FILE_PARALLEL) {
        const chunk = batch.slice(i, i + FILE_PARALLEL);
        await Promise.all(
          chunk.map(async (file) => {
            seen.add(file.token);
            try {
              await deleteObject(file.file_path);
              await fsDeleteFile(file.token);
              filesDeleted++;
            } catch (err) {
              console.error(`Cleanup error for ${file.token}:`, err);
              failed.add(file.token);
            }
          })
        );
      }
    }

    // Expired chat rooms. The first batch always runs; more only while time
    // is left and the last batch deleted something.
    // The hooks keep the admin's room history, which outlives the room (only
    // the retention step below removes it, after 365 days).
    let roomsDeleted = 0;
    let roomsFailed = false;
    const roomHooks = cronRoomHooks();
    try {
      do {
        n = await deleteExpiredRooms(roomHooks);
        roomsDeleted += n;
      } while (n > 0 && hasTime());
    } catch (err) {
      roomsFailed = true;
      console.error('Chat-room cleanup error:', err);
    }

    // Expired visitor blocks leave the enforcement list (never throws).
    const blocks = await getBlocks().service.sweepExpired();

    // Room history retention: only history docs past the retention period
    // (365 days), batches of 500, capped per run and by the delete budget.
    // Never throws. Live rooms' history is never touched.
    const history = await sweepRoomHistory(hasTime);
    const historyFailed = 'error' in history;

    const errors = [...failed];
    const timeBudgetUsed = !hasTime();
    // Counts only: the failed file tokens are share links, never stored [D-4].
    const blocksFailed = 'error' in blocks;
    reportRun(errors.length > 0 || roomsFailed || blocksFailed || historyFailed ? 'partial' : 'ok', startedAt, {
      filesDeleted,
      filesTotal: seen.size,
      filesFailed: errors.length,
      sessionsDeleted,
      roomsDeleted,
      roomsFailed,
      blocksSwept: 'removed' in blocks ? blocks.removed : null,
      blocksFailed,
      roomHistoryDeleted: history.removed,
      roomHistoryCapped: 'capped' in history ? history.capped : null,
      roomHistoryQuotaStopped: 'quotaStopped' in history ? history.quotaStopped : null,
      roomHistoryFailed: historyFailed,
      timeBudgetUsed,
    }, null);
    return NextResponse.json({
      success: true,
      message:
        filesDeleted + roomsDeleted + sessionsDeleted === 0
          ? 'Nothing to clean up'
          : 'Cleanup completed',
      filesDeleted,
      filesTotal: seen.size,
      sessionsDeleted,
      roomsDeleted,
      blocks,
      roomHistoryDeleted: history.removed,
      // True when the time budget ran out; the next run continues.
      timeBudgetUsed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error(`Cleanup error ${errorId}:`, error);
    reportRun('error', startedAt, {}, errorId);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
