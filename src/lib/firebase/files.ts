import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './admin';
import type { FileRecord } from '@/types';

export const FILES_COLLECTION = 'files';
export const RECEIVE_SESSIONS_COLLECTION = 'receive_sessions';

export type ReceiveSession = {
  session_token: string;
  file_token: string | null;
  created_at: string;
  expires_at: string;
  receiver_id: string | null;
};

export type NewFileInput = Omit<FileRecord, 'id' | 'created_at' | 'download_count'> & {
  created_at?: string;
};

function filesRef() {
  return adminDb().collection(FILES_COLLECTION);
}

function sessionsRef() {
  return adminDb().collection(RECEIVE_SESSIONS_COLLECTION);
}

export async function createFile(input: NewFileInput): Promise<FileRecord> {
  const created_at = input.created_at ?? new Date().toISOString();
  const doc: FileRecord = {
    id: input.token,
    token: input.token,
    file_path: input.file_path,
    original_name: input.original_name,
    size: input.size,
    mime_type: input.mime_type,
    owner_id: input.owner_id ?? null,
    created_at,
    is_encrypted: input.is_encrypted ?? false,
    expires_at: input.expires_at ?? null,
    max_downloads: input.max_downloads ?? null,
    download_count: 0,
  };
  // `create` fails if the doc already exists — gives us uniqueness for the token.
  await filesRef().doc(input.token).create(doc);
  return doc;
}

export async function getFile(token: string): Promise<FileRecord | null> {
  const snap = await filesRef().doc(token).get();
  if (!snap.exists) return null;
  return snap.data() as FileRecord;
}

export async function deleteFile(token: string): Promise<void> {
  await filesRef().doc(token).delete();
}

export async function listOwnerFiles(ownerId: string): Promise<FileRecord[]> {
  const snap = await filesRef()
    .where('owner_id', '==', ownerId)
    .orderBy('created_at', 'desc')
    .get();
  return snap.docs.map((d) => d.data() as FileRecord);
}

export async function countOwnerFiles(ownerId: string): Promise<number> {
  const snap = await filesRef().where('owner_id', '==', ownerId).count().get();
  return snap.data().count;
}

export async function updateFileExpiry(token: string, expires_at: string | null): Promise<void> {
  await filesRef().doc(token).update({ expires_at });
}

/**
 * Atomically increment download_count and, if the new count hits max_downloads,
 * delete the doc. Returns { newCount, selfDestruct, filePath } so the caller can
 * also delete the R2 object on self-destruct.
 */
export async function incrementDownloadAndMaybeDestruct(
  token: string
): Promise<{ newCount: number; selfDestruct: boolean; filePath: string | null }> {
  const db = adminDb();
  const ref = filesRef().doc(token);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return { newCount: 0, selfDestruct: false, filePath: null };
    }
    const data = snap.data() as FileRecord;
    const newCount = (data.download_count ?? 0) + 1;
    const selfDestruct =
      data.max_downloads !== null && newCount >= data.max_downloads;

    if (selfDestruct) {
      tx.delete(ref);
    } else {
      tx.update(ref, { download_count: FieldValue.increment(1) });
    }
    return { newCount, selfDestruct, filePath: data.file_path };
  });
}

export async function listExpiredAnonymousFiles(limit: number = 100): Promise<FileRecord[]> {
  const nowIso = new Date().toISOString();
  const snap = await filesRef()
    .where('owner_id', '==', null)
    .where('expires_at', '<', nowIso)
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as FileRecord);
}

// ---------- receive sessions ----------

export async function createReceiveSession(input: {
  session_token: string;
  receiver_id: string | null;
  ttlMs?: number;
}): Promise<ReceiveSession> {
  const now = Date.now();
  const ttlMs = input.ttlMs ?? 10 * 60 * 1000;
  const doc: ReceiveSession = {
    session_token: input.session_token,
    file_token: null,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
    receiver_id: input.receiver_id,
  };
  await sessionsRef().doc(input.session_token).create(doc);
  return doc;
}

export async function getReceiveSession(session_token: string): Promise<ReceiveSession | null> {
  const snap = await sessionsRef().doc(session_token).get();
  if (!snap.exists) return null;
  return snap.data() as ReceiveSession;
}

export async function attachFileToSession(session_token: string, file_token: string): Promise<void> {
  await sessionsRef().doc(session_token).update({ file_token });
}

export async function deleteExpiredReceiveSessions(): Promise<number> {
  const nowIso = new Date().toISOString();
  const snap = await sessionsRef().where('expires_at', '<', nowIso).limit(500).get();
  if (snap.empty) return 0;
  const batch = adminDb().batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}
