import 'server-only';

import { blockRef } from '@/shared/lib/block-values';
import { getBlocklistCache } from './cache';

// Shared contract with the phase 2 ingest (`/api/e`): keep this file name and
// these three signatures. Uses the same lazy 60 s cache as the proxy.

export type BlockSubject = { ip: string | null; uid: string | null; country: string | null; device: string | null };
export type BlockHit = { blockId: string; ref: string };

/**
 * The first live block that matches the subject, or null. Loads the
 * blocklist lazily (first call on an instance, then at most once per 60 s),
 * counts one hit on a match, and never throws: on a Firestore error it
 * answers from the last good list (fail open on a cold instance).
 */
export async function findBlock(subject: BlockSubject): Promise<BlockHit | null> {
  const cache = getBlocklistCache();
  const list = await cache.get();
  const now = Date.now();
  const match = list.match(subject, now);
  if (!match) return null;
  cache.recordHit(match.entry.id);
  return { blockId: match.entry.id, ref: blockRef(match.entry.id, now) };
}
