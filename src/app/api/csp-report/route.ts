import type { NextRequest } from 'next/server';

import { readCappedText } from '@/features/tracking/server/ingest';
import { CspReportLog, MAX_REPORT_BYTES, parseCspReports } from '@/server/security/csp-report';
import { clientKey, rateLimit } from '@/shared/lib/rate-limit';

/**
 * Browser CSP violation reports for the admin's report-only policy
 * (src/server/security/csp.ts). Log only: no Firestore write, ever.
 *
 * Always 204: a browser does nothing with the answer, and a forger learns
 * nothing. Per-IP rate limit, 16 KB body cap, and the log dedupes per
 * instance. Public by necessity (browsers send no cookie we could rely on);
 * the proxy matcher skips it, so it never pays for a blocklist read.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORTS_PER_IP_PER_MINUTE = 20;
const reportLog = new CspReportLog();

function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    if (!rateLimit(`csp:${clientKey(request)}`, REPORTS_PER_IP_PER_MINUTE, 60_000).allowed) return noContent();
    const text = await readCappedText(request, MAX_REPORT_BYTES);
    if (!text) return noContent();
    reportLog.record(parseCspReports(JSON.parse(text)));
  } catch {
    // Bad JSON or a read error: drop it.
  }
  return noContent();
}
