import type { NextRequest } from 'next/server';

import { countOnlineNow, getLive, type QueryResult } from '@/features/admin/analytics/queries';
import { can } from '@/server/auth/permissions';
import { requireAdminForRoute } from '@/server/auth/require-admin';
import { assertNotBlocked } from '@/server/blocklist/assert-not-blocked';
import { blockedApiResponse } from '@/server/blocklist/request';

/**
 * JSON for the Live page poll (every 30 s) and, with `?only=count`, the
 * top-bar / Overview "N online" poll (every 60 s, one `count()`).
 * 03-live.md "Route auth": requireAdmin('analytics:read'), 401 / 403 JSON.
 * Both results are cached 30 s in the data layer, so several admins share
 * one Firestore read set. IPs are masked on the server for roles without
 * `ip:read`.
 *
 * Body: the data layer's QueryResult. 200 `{ state: 'ok', data }`,
 * 200 `{ state: 'budget' }` (read cap reached: the client stops polling),
 * 500 `{ state: 'error', errorId }`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function respond<T>(result: QueryResult<T>): Response {
  return Response.json(result, { status: result.state === 'error' ? 500 : 200, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);

  const auth = await requireAdminForRoute('analytics:read');
  if (!auth.ok) return auth.response;

  if (request.nextUrl.searchParams.get('only') === 'count') return respond(await countOnlineNow());
  return respond(await getLive({ canSeeIp: can(auth.ctx.role, 'ip:read') }));
}
