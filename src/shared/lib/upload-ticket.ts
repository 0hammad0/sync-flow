import { createHmac, timingSafeEqual } from 'crypto';
import { objectSize, deleteObject } from '@/shared/lib/r2';

/**
 * Direct-to-R2 uploads happen in three steps:
 *   1. presign  — the server validates the request and returns a presigned PUT
 *                 URL plus a signed "ticket" describing what was approved
 *   2. PUT      — the browser sends the bytes straight to R2
 *   3. complete — the client hands the ticket back; the server checks the
 *                 signature, confirms the stored object's size, and only then
 *                 writes the metadata record
 *
 * The ticket is stateless (no pending rows to clean up). It is signed with a
 * key derived from the R2 secret, so it needs no extra environment variable
 * and can't be forged by anyone who doesn't already hold the bucket's keys.
 */

const TICKET_TTL_MS = 60 * 60 * 1000; // presign → complete must finish within 1 hour

function signingKey(): Buffer {
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  if (!secret) throw new Error('R2_SECRET_ACCESS_KEY is not set');
  return createHmac('sha256', secret).update('syncflow-upload-ticket-v1').digest();
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function createUploadTicket<T extends object>(data: T): string {
  const payload = Buffer.from(
    JSON.stringify({ ...data, exp: Date.now() + TICKET_TTL_MS })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Returns the ticket data, or null when the ticket is malformed, forged or expired. */
export function readUploadTicket<T extends object>(ticket: unknown): T | null {
  if (typeof ticket !== 'string' || ticket.length > 8192) return null;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return null;
  const payload = ticket.slice(0, dot);
  const given = Buffer.from(ticket.slice(dot + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data?.exp !== 'number' || data.exp < Date.now()) return null;
    return data as T;
  } catch {
    return null;
  }
}

/**
 * Confirm the browser really stored the approved object. On a size mismatch
 * the object is deleted so nothing unapproved stays in the bucket.
 * Returns an error message, or null when the object is fine.
 */
export async function verifyUploadedObject(key: string, expectedSize: number): Promise<string | null> {
  const size = await objectSize(key);
  if (size === null) return 'The file did not reach storage. Please try again.';
  if (size !== expectedSize) {
    await deleteObject(key).catch(() => {});
    return 'The stored file does not match the approved size. Please try again.';
  }
  return null;
}
