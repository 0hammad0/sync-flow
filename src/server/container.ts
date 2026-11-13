import 'server-only';

import { adminDb } from '@/shared/lib/firebase/admin';
import { FirestoreQuotaStore, QuotaGuard } from '@/server/quota/quota-guard';
import { FirestoreAuditRepository } from '@/server/repositories/firestore/audit-repository';
import { AuditService } from '@/server/services/audit-service';

/**
 * Composition root (no DI container). Built lazily on first use and kept for
 * the life of the server instance, so QuotaGuard's in-memory counts and the
 * audit service's rate limit survive across requests on that instance.
 * Nothing here runs at import time: importing this file costs no Firestore
 * call and needs no credentials.
 */
export type Container = {
  audit: AuditService;
  quota: QuotaGuard;
};

let container: Container | null = null;

export function getContainer(): Container {
  if (!container) {
    const db = adminDb();
    const quota = new QuotaGuard(new FirestoreQuotaStore(db));
    container = {
      quota,
      audit: new AuditService(new FirestoreAuditRepository(db, quota)),
    };
  }
  return container;
}

// ---------------------------------------------------------------------------
// Blocks (phase 1.5, access control). Kept as one block, imports included, so
// parallel phase-1 work merges cleanly. Shares the container's QuotaGuard.

import { adminAuth } from '@/shared/lib/firebase/admin';
import { FirebaseBlockUserLookup } from '@/server/blocklist/user-lookup';
import { FirestoreBlockRepository } from '@/server/repositories/firestore/block-repository';
import type { BlockRepository } from '@/server/repositories/interfaces';
import { BlockService } from '@/server/services/block-service';

export type BlockParts = {
  /** Also the blocklist cache's source (lazy read + hit flush). */
  repo: BlockRepository;
  service: BlockService;
};

let blockParts: BlockParts | null = null;

/** Built on first use: the first action request (cache) or the first admin access call. */
export function getBlocks(): BlockParts {
  if (!blockParts) {
    const repo = new FirestoreBlockRepository(adminDb(), getContainer().quota);
    blockParts = { repo, service: new BlockService(repo, new FirebaseBlockUserLookup(adminAuth())) };
  }
  return blockParts;
}
