import 'server-only';

import { IngestService } from '@/features/tracking/server/ingest';
import { findBlock } from '@/server/blocklist/find-block';
import { FirebaseBlockUserLookup } from '@/server/blocklist/user-lookup';
import { deviceKey } from '@/server/device-key';
import { FirestoreQuotaStore, QuotaGuard } from '@/server/quota/quota-guard';
import { FirestoreBlockRepository } from '@/server/repositories/firestore/block-repository';
import { FirestoreEventRepository } from '@/server/repositories/firestore/event-repository';
import type { BlockRepository, EventRepository } from '@/server/repositories/interfaces';
import { BlockService } from '@/server/services/block-service';
import { adminAuth, adminDb } from '@/shared/lib/firebase/admin';

/**
 * The part of the composition root that light routes need: the shared
 * QuotaGuard, the blocklist parts and the tracker ingest. No R2, no chat data
 * layer, no file services, so `/api/e` (and the proxy's blocklist cache) do
 * not bundle the AWS SDK. `container.ts` builds the rest on top of these same
 * instances, so every caller on an instance shares one QuotaGuard.
 * Nothing runs at import time.
 */

let quota: QuotaGuard | null = null;

/** The one QuotaGuard per server instance (admin, blocks and tracker share its daily caps). */
export function getQuota(): QuotaGuard {
  quota ??= new QuotaGuard(new FirestoreQuotaStore(adminDb()));
  return quota;
}

// ---------------------------------------------------------------------------
// Blocks (phase 1.5, access control).

export type BlockParts = {
  /** Also the blocklist cache's source (lazy read + hit flush). */
  repo: BlockRepository;
  service: BlockService;
};

let blockParts: BlockParts | null = null;

/** Built on first use: the first action request (cache) or the first admin access call. */
export function getBlocks(): BlockParts {
  if (!blockParts) {
    const repo = new FirestoreBlockRepository(adminDb(), getQuota());
    blockParts = { repo, service: new BlockService(repo, new FirebaseBlockUserLookup(adminAuth())) };
  }
  return blockParts;
}

// ---------------------------------------------------------------------------
// Tracker ingest (phase 2).

let events: EventRepository | null = null;
let ingest: IngestService | null = null;

export function getEventRepository(): EventRepository {
  events ??= new FirestoreEventRepository(adminDb(), getQuota());
  return events;
}

/** Firebase uid for a session cookie, or null. No revocation check: no network call per flush. */
async function uidFromSessionCookie(cookie: string): Promise<string | null> {
  try {
    return (await adminAuth().verifySessionCookie(cookie, false)).uid;
  } catch {
    return null;
  }
}

/**
 * The cached kill switch if ingest already exists on this instance, else
 * `null`. Never builds anything (no Firebase init), so `/api/e` can call it
 * before its 204.
 */
export function peekTrackingEnabled(): boolean | null {
  return ingest ? ingest.peekTrackingEnabled() : null;
}

export function getIngest(): IngestService {
  ingest ??= new IngestService({
    events: getEventRepository(),
    quota: getQuota(),
    findBlock,
    resolveUid: uidFromSessionCookie,
    hashDevice: deviceKey,
    mode: 'full',
  });
  return ingest;
}
