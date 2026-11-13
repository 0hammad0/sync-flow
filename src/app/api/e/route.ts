import { after, type NextRequest } from 'next/server';

import { readRequestMeta } from '@/features/tracking/server/enrich';
import { acceptBeacon } from '@/features/tracking/server/ingest';
import { getIngest } from '@/server/container-light';
import { siteUrl } from '@/shared/lib/site';

/**
 * Tracker ingest. Always answers 204, whatever happens: a tracker problem
 * must never reach the page (hard rule 8), and blocked visitors get no signal
 * either (T-27). Before the answer: caps, origin, rate limit, zod (memory
 * only). Every Firestore call runs inside `after()`, so the visitor never
 * waits for one (T-24).
 *
 * Not behind requireAdmin: public by design, like the tracker that calls it.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

function allowedHosts(request: NextRequest): string[] {
  const hosts = new Set<string>([request.nextUrl.host, siteUrl().host]);
  const host = request.headers.get('host');
  if (host) hosts.add(host);
  return [...hosts];
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const meta = readRequestMeta(request);
    const beacon = await acceptBeacon(request, { allowedHosts: allowedHosts(request), ip: meta.ip });
    if (beacon) {
      const host = request.nextUrl.host;
      after(() => getIngest().ingest(beacon, { ...meta, host }).then(() => undefined));
    }
  } catch (error) {
    console.error('[ingest] request rejected', error);
  }
  return noContent();
}
