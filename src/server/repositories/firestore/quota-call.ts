import 'server-only';

import type { QuotaMeter } from '@/server/quota/quota-guard';

/**
 * Runs one Firestore call and feeds any error to QuotaGuard (so a
 * RESOURCE_EXHAUSTED sets the stop flag), then rethrows. Counting the
 * operations that succeeded stays with the caller, which knows how many.
 */
export async function guarded<T>(quota: QuotaMeter, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    quota.noteError(error);
    throw error;
  }
}

/** gRPC status 5 (Admin SDK) or the string form. */
export function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 5 || code === 'not-found' || code === 'NOT_FOUND';
}

/** base64url(JSON) cursor helpers. A broken cursor decodes to null (first page). */
export function encodeJsonCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeJsonCursor(cursor: string | null | undefined): unknown {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    return null;
  }
}
