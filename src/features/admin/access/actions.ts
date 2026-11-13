'use server';

import { headers } from 'next/headers';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/require-admin';
import { assertNotBlocked } from '@/server/blocklist/assert-not-blocked';
import { getBlocklistCache } from '@/server/blocklist/cache';
import { clientCountry, clientIp } from '@/server/blocklist/request';
import { getBlocks } from '@/server/container';
import { toActionFailure, type ActionResult } from '@/server/errors';
import type { BlockActor } from '@/server/services/block-service';
import { BLOCKS_TAG, toBlockRowDto } from './queries';
import { blockSubjectSchema, unblockSubjectSchema } from './schemas';
import type { BlockRowDto } from './types';

// Access-control actions. Each one: block check (admins are visitors too,
// T-27) → requireAdmin('blocks:write') (T-6) → zod → BlockService (one
// transaction: block + enforcement copy + audit row) → cache refresh.

async function actor(): Promise<BlockActor> {
  const h = await headers();
  return { ip: clientIp(h), country: clientCountry(h), userAgent: h.get('user-agent') };
}

/** This instance applies the change at once; others within 60 s (cache age). */
function afterWrite() {
  updateTag(BLOCKS_TAG);
  getBlocklistCache().invalidate();
}

export async function blockSubject(input: unknown): Promise<ActionResult<BlockRowDto>> {
  const blocked = await assertNotBlocked();
  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
  try {
    const ctx = await requireAdmin('blocks:write');
    const parsed = blockSubjectSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid', fields: z.flattenError(parsed.error).fieldErrors };
    const result = await getBlocks().service.create({ ctx, ...parsed.data, actor: await actor() });
    if (!result.ok) return toActionFailure(result.error);
    afterWrite();
    return { ok: true, data: toBlockRowDto(result.data) };
  } catch (e) {
    return toActionFailure(e);
  }
}

export async function unblockSubject(input: unknown): Promise<ActionResult<{ id: string; value: string }>> {
  const blocked = await assertNotBlocked();
  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
  try {
    const ctx = await requireAdmin('blocks:write');
    const parsed = unblockSubjectSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid', fields: z.flattenError(parsed.error).fieldErrors };
    const result = await getBlocks().service.remove({ ctx, id: parsed.data.id, actor: await actor() });
    if (!result.ok) return toActionFailure(result.error);
    afterWrite();
    return { ok: true, data: { id: result.data.id, value: result.data.value } };
  } catch (e) {
    return toActionFailure(e);
  }
}
