import 'server-only';

import { cookies, headers } from 'next/headers';
import { SESSION_COOKIE } from '@/shared/lib/firebase/session';
import type { BlockHit } from './find-block';
import { blockedApiResponse, clientCountry, clientIp, findBlockForRequest } from './request';

export type { BlockHit };

export type AssertNotBlockedInput = {
  /** Public device key (32 hex) when the route knows it from the body: chat routes. */
  device?: string | null;
  /** A uid the caller already verified. */
  uid?: string | null;
};

/**
 * Second check (T-6 style) inside every action entry point: server actions
 * and the upload / send / chat write routes. Same lazy cache as the proxy,
 * so it costs one in-memory lookup once the list is loaded. Adds the device
 * key, which the proxy cannot see (it is in the request body).
 *
 * Returns the hit (caller answers with `error: 'blocked'` + `ref`) or null.
 * Never throws. Must not run during a page render: pages call the plain
 * `server-only` loaders, never a `'use server'` export (option (a), step 6).
 *
 *   const blocked = await assertNotBlocked();
 *   if (blocked) return blockedApiResponse(blocked);      // route
 *   if (blocked) return blockedActionResult(blocked);     // server action
 */
export async function assertNotBlocked(input: AssertNotBlockedInput = {}): Promise<BlockHit | null> {
  const h = await headers();
  const sessionCookie = input.uid ? null : ((await cookies()).get(SESSION_COOKIE)?.value ?? null);
  return findBlockForRequest({
    ip: clientIp(h),
    country: clientCountry(h),
    device: input.device ?? null,
    uid: input.uid ?? null,
    sessionCookie,
  });
}

export type BlockedResult = { success: false; error: 'blocked'; ref: string };

/** The public actions' `{ success, error }` shape. */
export function blockedActionResult(hit: BlockHit): BlockedResult {
  return { success: false, error: 'blocked', ref: hit.ref };
}

export { blockedApiResponse };
