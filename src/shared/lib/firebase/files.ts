import { randomBytes } from 'crypto';
import { FieldValue, type CollectionReference, type Firestore, type Query, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from './admin';
import type { FileRecord } from '@/types';
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '@/shared/lib/limits';

export const FILES_COLLECTION = 'files';
export const RECEIVE_SESSIONS_COLLECTION = 'receive_sessions';
// One tiny server-only doc per signed-in owner: { updated_at }. Every file
// creation for that owner reads and writes it inside its transaction, so
// they run one at a time and the owner file cap can't be overshot.
export const OWNER_LOCKS_COLLECTION = 'owner_locks';

export type ReceiveSession = {
  session_token: string;
  // Latest file (legacy field, kept for compatibility).
  file_token: string | null;
  // All files sent in this session, in arrival order.
  file_tokens?: string[];
  created_at: string;
  expires_at: string;
  receiver_id: string | null;
  // Short code typed at /send when the QR can't be scanned (older sessions lack it).
  short_code?: string;
};

// Phone→PC sessions accept several files; cap stops runaway scripts.
export const MAX_SESSION_FILES = 25;

export type NewFileInput = Omit<FileRecord, 'id' | 'created_at' | 'download_count'> & {
  created_at?: string;
};

function filesRef() {
  return adminDb().collection(FILES_COLLECTION);
}

function sessionsRef() {
  return adminDb().collection(RECEIVE_SESSIONS_COLLECTION);
}

function toFileRecord(input: NewFileInput): FileRecord {
  return {
    id: input.token,
    token: input.token,
    file_path: input.file_path,
    original_name: input.original_name,
    size: input.size,
    mime_type: input.mime_type,
    owner_id: input.owner_id ?? null,
    created_at: input.created_at ?? new Date().toISOString(),
    is_encrypted: input.is_encrypted ?? false,
    expires_at: input.expires_at ?? null,
    max_downloads: input.max_downloads ?? null,
    download_count: 0,
  };
}

/**
 * Inside a transaction: take this owner's lock and check their file count.
 * Returns false when the owner is at the cap (nothing written). On true the
 * lock doc is written, so a concurrent creation for the same owner conflicts
 * and retries, then sees this file in its own count.
 * Firestore needs all reads before writes, so call it after the caller's reads.
 */
async function takeOwnerSlot(tx: Transaction, ownerId: string, maxOwnerFiles: number): Promise<boolean> {
  const lockRef = adminDb().collection(OWNER_LOCKS_COLLECTION).doc(ownerId);
  const [, owned] = await Promise.all([
    tx.get(lockRef),
    tx.get(filesRef().where('owner_id', '==', ownerId).count()),
  ]);
  if (owned.data().count >= maxOwnerFiles) return false;
  tx.set(lockRef, { updated_at: new Date().toISOString() });
  return true;
}

export type CreateOwnedFileResult = { ok: true; file: FileRecord } | { ok: false; reason: 'owner_full' };

/**
 * Create a file record, refusing atomically when a signed-in owner already has
 * maxOwnerFiles files. Guests (no owner) are not capped.
 */
export async function createFileWithinCap(
  input: NewFileInput,
  maxOwnerFiles: number
): Promise<CreateOwnedFileResult> {
  const doc = toFileRecord(input);
  if (!doc.owner_id) return { ok: true, file: await createFile(input) };
  const ownerId = doc.owner_id;
  return await adminDb().runTransaction(async (tx) => {
    if (!(await takeOwnerSlot(tx, ownerId, maxOwnerFiles))) {
      return { ok: false, reason: 'owner_full' } as const;
    }
    // `create` fails if the doc already exists — gives us uniqueness for the token.
    tx.create(filesRef().doc(doc.token), doc);
    return { ok: true, file: doc } as const;
  });
}

export async function createFile(input: NewFileInput): Promise<FileRecord> {
  const doc = toFileRecord(input);
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

export type DownloadClaim =
  | { status: 'ok'; file: FileRecord; newCount: number; spent: boolean }
  | { status: 'not_found' | 'expired' | 'limit' };

/**
 * Count a download BEFORE the caller hands out a signed URL. Atomically checks
 * expiry and max_downloads and refuses when the limit is already reached, so
 * the limit can't be bypassed by reusing a page or a URL. When this claim uses
 * up the last download the doc is marked `spent_at` (not deleted yet — the
 * claimant still has to fetch the object); deleteIfSpent() removes it later.
 */
export async function claimDownload(token: string): Promise<DownloadClaim> {
  const db = adminDb();
  const ref = filesRef().doc(token);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 'not_found' as const };
    const data = snap.data() as FileRecord;
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { status: 'expired' as const };
    }
    const count = data.download_count ?? 0;
    if (data.max_downloads !== null && count >= data.max_downloads) {
      return { status: 'limit' as const };
    }
    const newCount = count + 1;
    const spent = data.max_downloads !== null && newCount >= data.max_downloads;
    tx.update(ref, {
      download_count: FieldValue.increment(1),
      ...(spent ? { spent_at: new Date().toISOString() } : {}),
    });
    return { status: 'ok' as const, file: data, newCount, spent };
  });
}

/**
 * Self-destruct: delete the doc of a file whose download limit is used up.
 * `minAgeMs` waits that long after the last claim (so an in-flight signed URL
 * can still finish). Returns the R2 key to delete, or null if nothing to do.
 */
export async function deleteIfSpent(token: string, minAgeMs = 0): Promise<string | null> {
  const db = adminDb();
  const ref = filesRef().doc(token);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as FileRecord & { spent_at?: string };
    if (data.max_downloads === null || (data.download_count ?? 0) < data.max_downloads) {
      return null;
    }
    if (minAgeMs > 0 && data.spent_at && Date.now() - Date.parse(data.spent_at) < minAgeMs) {
      return null;
    }
    tx.delete(ref);
    return data.file_path;
  });
}

/**
 * Cleanup cron: re-read the file and delete its record only while it is still
 * past `expires_at`. An owner can reshare (new expiry, or `null` = never)
 * between the cron listing the file and deleting it; then it is kept.
 * Returns the R2 key to delete after this, or null when the file is kept.
 */
export async function deleteIfExpiredIn(
  db: Firestore,
  files: CollectionReference,
  token: string,
  nowIso: string,
): Promise<string | null> {
  const ref = files.doc(token);
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as FileRecord;
    if (typeof data.expires_at !== 'string' || data.expires_at >= nowIso) return null;
    tx.delete(ref);
    return data.file_path;
  });
}

export function deleteIfExpired(token: string, nowIso: string = new Date().toISOString()): Promise<string | null> {
  return deleteIfExpiredIn(adminDb(), filesRef(), token, nowIso);
}

/**
 * Files past `expires_at`, guest or signed-in: an owner who picked an expiry
 * gets it enforced too (phase 1 step 1.0). Files with no expiry store `null`,
 * which never matches `<`, so they are never listed. Single-field index only.
 */
export function expiredFilesQuery(files: CollectionReference, nowIso: string, limit: number): Query {
  return files.where('expires_at', '<', nowIso).limit(limit);
}

export async function listExpiredFiles(limit: number = 100): Promise<FileRecord[]> {
  const snap = await expiredFilesQuery(filesRef(), new Date().toISOString(), limit).get();
  return snap.docs.map((d) => d.data() as FileRecord);
}

// ---------- receive sessions ----------

// The alphabet has 32 symbols, so `byte & 31` picks one without bias.
function randomShortCode(): string {
  const bytes = randomBytes(SHORT_CODE_LENGTH);
  let code = '';
  for (const b of bytes) code += SHORT_CODE_ALPHABET[b & 31];
  return code;
}

/** A code no live session is using. Codes only need to be unique while a session is open. */
async function freeShortCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = randomShortCode();
    if (!(await findReceiveSessionByCode(code))) return code;
  }
  return randomShortCode(); // ~1e9 codes; five live clashes in a row won't happen
}

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
    file_tokens: [],
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
    receiver_id: input.receiver_id,
    short_code: await freeShortCode(),
  };
  await sessionsRef().doc(input.session_token).create(doc);
  return doc;
}

export async function getReceiveSession(session_token: string): Promise<ReceiveSession | null> {
  const snap = await sessionsRef().doc(session_token).get();
  if (!snap.exists) return null;
  return snap.data() as ReceiveSession;
}

/** The open (unexpired) session using this short code, if any. */
export async function findReceiveSessionByCode(code: string): Promise<ReceiveSession | null> {
  // Equality-only query: served by Firestore's automatic single-field index.
  const snap = await sessionsRef().where('short_code', '==', code).limit(5).get();
  const now = new Date();
  const open = snap.docs
    .map((d) => d.data() as ReceiveSession)
    .find((s) => new Date(s.expires_at) > now);
  return open ?? null;
}

export type ExtendSessionResult =
  | { ok: true; session: ReceiveSession }
  | { ok: false; reason: 'not_found' | 'too_old' };

/**
 * Push expires_at to now + extendMs, capped at created_at + maxAgeMs. Works on
 * an already-expired session as long as it is still under the age cap.
 */
export async function extendReceiveSession(
  session_token: string,
  extendMs: number,
  maxAgeMs: number
): Promise<ExtendSessionResult> {
  const ref = sessionsRef().doc(session_token);
  return await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: 'not_found' } as const;
    const session = snap.data() as ReceiveSession;
    const now = Date.now();
    const cap = new Date(session.created_at).getTime() + maxAgeMs;
    const next = Math.min(now + extendMs, cap);
    // Less than a minute left under the cap is not worth extending.
    if (next - now < 60_000) return { ok: false, reason: 'too_old' } as const;
    const expires_at = new Date(Math.max(next, new Date(session.expires_at).getTime())).toISOString();
    tx.update(ref, { expires_at });
    return { ok: true, session: { ...session, expires_at } } as const;
  });
}

export type CreateSessionFileResult =
  | { ok: true; file: FileRecord }
  | { ok: false; reason: 'session_not_found' | 'session_full' | 'owner_full' };

/**
 * Write a phone → PC file record and attach it to its receive session in one
 * transaction. Presign checks the caps too, but its tickets are stateless, so
 * many presigns could otherwise all complete and overshoot them; here the
 * session's file count and the receiver's file count are re-checked against
 * what is actually stored. Concurrent completes on one session, or for one
 * owner across sessions (via the owner lock), retry instead of racing.
 * Nothing is written when a cap is hit.
 */
export async function createSessionFile(
  session_token: string,
  input: NewFileInput,
  maxOwnerFiles: number
): Promise<CreateSessionFileResult> {
  const doc = toFileRecord(input);
  const sessionRef = sessionsRef().doc(session_token);
  return await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) return { ok: false, reason: 'session_not_found' } as const;
    const session = snap.data() as ReceiveSession;
    const sent = session.file_tokens?.length ?? (session.file_token ? 1 : 0);
    if (sent >= MAX_SESSION_FILES) return { ok: false, reason: 'session_full' } as const;
    if (doc.owner_id && !(await takeOwnerSlot(tx, doc.owner_id, maxOwnerFiles))) {
      return { ok: false, reason: 'owner_full' } as const;
    }
    // `create` fails if the doc already exists — gives us uniqueness for the token.
    tx.create(filesRef().doc(doc.token), doc);
    tx.update(sessionRef, {
      file_token: doc.token, // latest, for old readers
      file_tokens: FieldValue.arrayUnion(doc.token),
    });
    return { ok: true, file: doc } as const;
  });
}

// Expired sessions are kept this long before cleanup deletes them, so a file
// that completes late (its upload ticket lives 1 hour) can still attach and
// show up on the PC.
const EXPIRED_SESSION_RETENTION_MS = 60 * 60 * 1000;

/** Deletes up to `limit` (max 500, one batch) expired sessions; returns how many. */
export async function deleteExpiredReceiveSessions(limit = 500): Promise<number> {
  const cutoffIso = new Date(Date.now() - EXPIRED_SESSION_RETENTION_MS).toISOString();
  const snap = await sessionsRef().where('expires_at', '<', cutoffIso).limit(limit).get();
  if (snap.empty) return 0;
  const batch = adminDb().batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}
