import 'server-only';

import { adminAuth, adminDb } from '@/shared/lib/firebase/admin';
import { FirestoreQuotaStore, QuotaGuard } from '@/server/quota/quota-guard';
import { FirestoreAuditRepository } from '@/server/repositories/firestore/audit-repository';
import { AuditService } from '@/server/services/audit-service';
// --- phase 1 core ---
import type { CronRunRepository } from '@/server/repositories/interfaces';
import { FirestoreCronRunRepository } from '@/server/repositories/firestore/cron-run-repository';
import { FirestoreFileRepository } from '@/server/repositories/firestore/file-repository';
import { FirestoreRoomHistoryRepository } from '@/server/repositories/firestore/room-history-repository';
import { FirestoreRoomRepository } from '@/server/repositories/firestore/room-repository';
import { FirebaseUserRepository } from '@/server/repositories/firestore/user-repository';
import { R2StorageRepository } from '@/server/repositories/r2/storage-repository';
import { FileService } from '@/server/services/file-service';
import { RoomService } from '@/server/services/room-service';
import { UserService } from '@/server/services/user-service';
// --- end phase 1 core ---

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
  // --- phase 1 core ---
  files: FileService;
  rooms: RoomService;
  users: UserService;
  cronRuns: CronRunRepository;
  // --- end phase 1 core ---
};

let container: Container | null = null;

export function getContainer(): Container {
  if (!container) {
    const db = adminDb();
    const quota = new QuotaGuard(new FirestoreQuotaStore(db));
    const audit = new AuditService(new FirestoreAuditRepository(db, quota));
    container = {
      quota,
      audit,
      ...phase1Core(db, quota, audit),
    };
  }
  return container;
}

// --- phase 1 core ---
function phase1Core(db: ReturnType<typeof adminDb>, quota: QuotaGuard, audit: AuditService) {
  const fileRepo = new FirestoreFileRepository(db, quota);
  const roomRepo = new FirestoreRoomRepository(db, quota);
  const userRepo = new FirebaseUserRepository(adminAuth(), db, quota);
  return {
    files: new FileService({ reader: fileRepo, remover: fileRepo, storage: new R2StorageRepository(), audit }),
    rooms: new RoomService({
      reader: roomRepo,
      closer: roomRepo,
      history: new FirestoreRoomHistoryRepository(db, quota),
      audit,
    }),
    users: new UserService({ reader: userRepo, admin: userRepo, audit }),
    cronRuns: new FirestoreCronRunRepository(db, quota),
  };
}
// --- end phase 1 core ---
