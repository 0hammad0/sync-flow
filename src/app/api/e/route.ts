import { after, type NextRequest } from 'next/server';

import type { Region } from '@/features/tracking/cookies';
import { readRequestMeta } from '@/features/tracking/server/enrich';
import { acceptBeacon } from '@/features/tracking/server/ingest';
import { regionCookie, regionFor } from '@/features/tracking/server/region';
import { getIngest, peekTrackingEnabled } from '@/server/container-light';
import { siteUrl } from '@/shared/lib/site';

/**
 * Tracker ingest. Always answers 204, whatever happens: a tracker problem
 * must never reach the page (hard rule 8), and blocked visitors get no signal
 * either (T-27). Before the answer: caps, origin, rate limit, zod (memory
 * only). Every Firestore call runs inside `after()`, so the visitor never
 * waits for one (T-24).
 *
 * `GET` is the loader's region / kill-switch probe: it sets the `sf_cr`
 * cookie (`eu`, `ok` or `off`) and nothing else. The loader calls it after
 * idle, at most once a day per visitor (once an hour while tracking is off).
 * It reads the kill switch from ingest's 60 s cache (≤ 1 read per 60 s per
 * instance); the visitor waits for nothing, the page is already idle.
 *
 * Not behind requireAdmin: public by design, like the tracker that calls it.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noContent(cookie?: string): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 204, headers });
}

function allowedHosts(request: NextRequest): string[] {
  const hosts = new Set<string>([request.nextUrl.host, siteUrl().host]);
  const host = request.headers.get('host');
  if (host) hosts.add(host);
  return [...hosts];
}

const isSecure = (request: NextRequest) => request.nextUrl.protocol === 'https:';

export async function GET(request: NextRequest): Promise<Response> {
  let region: Region = 'off';
  try {
    if (await getIngest().trackingEnabled()) {
      region = regionFor(request.headers.get('x-vercel-ip-country'), Boolean(process.env.VERCEL));
    }
  } catch (error) {
    // Fail closed: no settings, no tracker.
    console.error('[ingest] region probe failed', error);
  }
  return noContent(regionCookie(region, isSecure(request)));
}

export async function POST(request: NextRequest): Promise<Response> {
  let cookie: string | undefined;
  try {
    const meta = readRequestMeta(request);
    const beacon = await acceptBeacon(request, { allowedHosts: allowedHosts(request), ip: meta.ip });
    if (beacon) {
      const host = request.nextUrl.host;
      after(() => getIngest().ingest(beacon, { ...meta, host }).then(() => undefined));
    }
    // Tracking switched off since the tab started: tell its tracker to stop.
    // Cached value only; nothing is read before the 204.
    if (peekTrackingEnabled() === false) cookie = regionCookie('off', isSecure(request));
  } catch (error) {
    console.error('[ingest] request rejected', error);
  }
  return noContent(cookie);
}
