'use server';

import { z } from 'zod';
import { requireAdmin } from '@/server/auth/require-admin';
import { assertNotBlocked } from '@/server/blocklist/assert-not-blocked';
import { toActionFailure, type ActionResult } from '@/server/errors';
import { rateLimit } from '@/shared/lib/rate-limit';
import { SEARCH_MAX, SEARCH_MIN, detectQuery } from './search-detect';
import { runAdminSearch, searchLookups } from './search-queries';
import type { SearchResultDto } from './search-types';

// Command palette search (16-command-palette.md "Actions"). Read only, but
// still an action entry point: block check (admins are visitors too, T-27) →
// requireAdmin('analytics:read') (T-6) → per-admin rate limit → zod →
// runAdminSearch, where every result group re-checks its own permission.

/** 60 searches a minute per admin (per server instance, like every limiter here). */
const SEARCH_RATE = { max: 60, windowMs: 60_000 } as const;

const searchSchema = z.object({ q: z.string().trim().min(SEARCH_MIN).max(SEARCH_MAX) });

export async function searchAdmin(input: unknown): Promise<ActionResult<SearchResultDto>> {
  const blocked = await assertNotBlocked();
  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
  try {
    const ctx = await requireAdmin('analytics:read');
    const limit = rateLimit(`admin-palette:${ctx.uid}`, SEARCH_RATE.max, SEARCH_RATE.windowMs);
    if (!limit.allowed) return { ok: false, error: 'rate_limited', retryAfterSec: Math.ceil(limit.retryAfterMs / 1000) };
    const parsed = searchSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid', fields: z.flattenError(parsed.error).fieldErrors };
    const data = await runAdminSearch(ctx, detectQuery(parsed.data.q), { ...searchLookups, check: requireAdmin });
    return { ok: true, data };
  } catch (e) {
    return toActionFailure(e);
  }
}
