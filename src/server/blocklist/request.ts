import 'server-only';

import { adminAuth } from '@/shared/lib/firebase/admin';
import { getBlocklistCache } from './cache';
import { findBlock, type BlockHit } from './find-block';

type HeaderReader = { get(name: string): string | null };

/** Same order as rate-limit clientKey() and requireAdmin. Vercel overwrites both headers. */
export function clientIp(headers: HeaderReader): string | null {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || null;
}

/** ISO alpha-2 from Vercel's geo header, or null (local, unknown). */
export function clientCountry(headers: HeaderReader): string | null {
  const code = headers.get('x-vercel-ip-country')?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

export type RequestFacts = {
  ip: string | null;
  country: string | null;
  /** Public device key (32 hex), when the caller knows it (chat routes). */
  device?: string | null;
  /** A uid the caller already verified. Skips the cookie verify. */
  uid?: string | null;
  /** Raw `__session` cookie: verified only when a uid block exists. */
  sessionCookie?: string | null;
};

export type VerifySession = (cookie: string) => Promise<string | null>;

/** Local JWT check (no revocation call). Errors mean "no uid". */
const verifySession: VerifySession = async (cookie) => {
  try {
    return (await adminAuth().verifySessionCookie(cookie, false)).uid;
  } catch {
    return null;
  }
};

/**
 * Blocklist check for one action request. The uid comes from the session
 * cookie, verified only when the list holds a uid block, so most actions
 * pay one in-memory lookup and nothing else.
 */
export async function findBlockForRequest(facts: RequestFacts, verify: VerifySession = verifySession): Promise<BlockHit | null> {
  const list = await getBlocklistCache().get();
  if (list.isEmpty) return null;
  let uid = facts.uid ?? null;
  if (!uid && facts.sessionCookie && list.hasUids) uid = await verify(facts.sessionCookie);
  return findBlock({ ip: facts.ip, country: facts.country, device: facts.device ?? null, uid });
}

const NO_STORE = 'private, no-store';

/** `/api/**`: 403 JSON. `success: false` keeps the existing `{ success, error }` clients working. */
export function blockedApiResponse(hit: BlockHit): Response {
  return Response.json(
    { success: false, error: 'blocked', ref: hit.ref },
    { status: 403, headers: { 'cache-control': NO_STORE, 'x-block-ref': hit.ref } },
  );
}

/**
 * Server action (a POST to a page URL): 403 with the same JSON as text.
 * Next 16.4.6's action client throws `new Error(body)` for a non-RSC 4xx
 * whose content type is exactly `text/plain`, so the browser handler can
 * read the ref from the error message. Any other type loses the body.
 */
export function blockedActionResponse(hit: BlockHit): Response {
  return new Response(JSON.stringify({ error: 'blocked', ref: hit.ref }), {
    status: 403,
    headers: { 'content-type': 'text/plain', 'cache-control': NO_STORE, 'x-block-ref': hit.ref },
  });
}
