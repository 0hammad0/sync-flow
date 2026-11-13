import { NextResponse, type NextRequest } from 'next/server';

import { getTrackingContainer } from '@/server/container';
import { isCronAuthorized } from '@/server/cron/cron-auth';

/**
 * Nightly analytics rollup + retention (vercel.json, daily, an hour after
 * /api/cleanup). Auth: CRON_SECRET only, same timing-safe check as cleanup,
 * not requireAdmin: Vercel Cron has no admin session. Fails closed when the
 * secret is not set.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The run stops itself after 45 s; this leaves room for the batch in flight.
export const maxDuration = 60;

async function runRollup(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    if (!process.env.CRON_SECRET) console.error('Rollup refused: CRON_SECRET is not set.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await getTrackingContainer().rollup.run();
  return NextResponse.json(result, { status: result.status === 'failed' ? 500 : 200 });
}

// Vercel Cron calls GET; POST is for manual runs.
export const GET = runRollup;
export const POST = runRollup;
