'use server';

import { headers } from 'next/headers';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/require-admin';
import { requireRecentAuth } from '@/server/auth/step-up';
import { assertNotBlocked } from '@/server/blocklist/assert-not-blocked';
import { clientIp } from '@/server/blocklist/request';
import { getContainer } from '@/server/container';
import { isDomainError, toActionFailure, type ActionFailure, type ActionResult } from '@/server/errors';
import type { BulkDeleteResult } from '@/server/services/file-service';
import { FILES_TAG, errorKind } from './queries';
import { deleteFileSchema, deleteFilesSchema } from './schemas';

// Files & storage actions (09-files-and-storage.md "Actions"). Each one:
// block check (admins are visitors too, T-27) → requireAdmin('files:delete')
// (T-6) → step-up (sign-in within 15 min) → zod → FileService, which deletes
// the R2 object first, then the record, then writes one `file.delete` audit
// row per file (no file name, D-6) → cache refresh.

/**
 * toActionFailure, but an unexpected error is logged by name and code only:
 * an R2 or Firestore message can hold the object key (`{token}/{name}`) or a
 * doc path with the share token.
 */
function failure(e: unknown): ActionFailure {
  if (isDomainError(e)) return toActionFailure(e);
  const errorId = crypto.randomUUID();
  console.error(`[admin] files: delete failed ${errorId}`, errorKind(e));
  return { ok: false, error: 'internal', errorId };
}

async function request() {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get('user-agent') };
}

export async function deleteFile(input: unknown): Promise<ActionResult<{ id: string }>> {
  const blocked = await assertNotBlocked();
  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
  try {
    const ctx = await requireAdmin('files:delete');
    requireRecentAuth(ctx);
    const parsed = deleteFileSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid', fields: z.flattenError(parsed.error).fieldErrors };
    const result = await getContainer().files.deleteFile(ctx, parsed.data.id, {
      reason: parsed.data.reason,
      request: await request(),
    });
    if (!result.ok) {
      // Already gone (cron, another admin): the row should drop out too.
      updateTag(FILES_TAG);
      return { ...toActionFailure(result.error), message: 'This file was already deleted.' };
    }
    updateTag(FILES_TAG);
    return { ok: true, data: result.data };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteFiles(input: unknown): Promise<ActionResult<BulkDeleteResult>> {
  const blocked = await assertNotBlocked();
  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
  try {
    const ctx = await requireAdmin('files:delete');
    requireRecentAuth(ctx);
    const parsed = deleteFilesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid', fields: z.flattenError(parsed.error).fieldErrors };
    const result = await getContainer().files.deleteFiles(ctx, parsed.data.ids, {
      reason: parsed.data.reason,
      request: await request(),
    });
    if (!result.ok) return toActionFailure(result.error);
    if (result.data.deleted.length > 0 || result.data.missing.length > 0) updateTag(FILES_TAG);
    return { ok: true, data: result.data };
  } catch (e) {
    return failure(e);
  }
}
