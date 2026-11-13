import 'server-only';

import { adminDb } from '@/shared/lib/firebase/admin';
import { FirestoreQuotaStore, QuotaGuard } from '@/server/quota/quota-guard';
import { FirestoreAuditRepository } from '@/server/repositories/firestore/audit-repository';
import { AuditService } from '@/server/services/audit-service';
import { IngestService } from '@/features/tracking/server/ingest';
import { RollupService } from '@/features/tracking/server/rollup';
import { findBlock } from '@/server/blocklist/find-block';
import { recordCronRun } from '@/server/cron/record-cron-run';
import { FirestoreEventRepository } from '@/server/repositories/firestore/event-repository';
import type { EventRepository } from '@/server/repositories/interfaces';
import { adminAuth } from '@/shared/lib/firebase/admin';
import { deviceKey } from '@/shared/lib/firebase/chat';

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
// Tracking (phase 2). Built on first use, like the container above, and
// shares its QuotaGuard so tracker writes count against the same daily caps.
// ---------------------------------------------------------------------------

export type TrackingContainer = {
  events: EventRepository;
  ingest: IngestService;
  rollup: RollupService;
};

let tracking: TrackingContainer | null = null;

/** Firebase uid for a session cookie, or null. No revocation check: no network call per flush. */
async function uidFromSessionCookie(cookie: string): Promise<string | null> {
  try {
    return (await adminAuth().verifySessionCookie(cookie, false)).uid;
  } catch {
    return null;
  }
}

export function getTrackingContainer(): TrackingContainer {
  if (!tracking) {
    const { quota } = getContainer();
    const events = new FirestoreEventRepository(adminDb(), quota);
    tracking = {
      events,
      ingest: new IngestService({
        events,
        quota,
        findBlock,
        resolveUid: uidFromSessionCookie,
        hashDevice: deviceKey,
        mode: 'full',
      }),
      rollup: new RollupService({ events, quota, recordCronRun }),
    };
  }
  return tracking;
}
