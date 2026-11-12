import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  deleteExpiredReceiveSessions,
  deleteFile as fsDeleteFile,
  listExpiredAnonymousFiles,
} from '@/shared/lib/firebase/files';
import { deleteExpiredRooms } from '@/shared/lib/firebase/chat';
import { deleteObject } from '@/shared/lib/r2';

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

// Vercel Cron calls GET. POST stays for manual runs and scripts/e2e-cleanup.mjs.
export const GET = runCleanup;
export const POST = runCleanup;

async function runCleanup(request: NextRequest) {
  if (!isAuthorized(request)) {
    if (!process.env.CRON_SECRET) console.error('Cleanup refused: CRON_SECRET is not set.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
    let roomsDeleted = 0;
    try {
      do {
        n = await deleteExpiredRooms();
        roomsDeleted += n;
      } while (n > 0 && hasTime());
    } catch (err) {
      console.error('Chat-room cleanup error:', err);
    }

    const errors = [...failed];
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
      // True when the time budget ran out; the next run continues.
      timeBudgetUsed: !hasTime(),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
