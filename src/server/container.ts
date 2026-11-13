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
