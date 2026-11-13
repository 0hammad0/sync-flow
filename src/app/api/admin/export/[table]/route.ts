import type { NextRequest } from 'next/server';
import { after } from 'next/server';
import { planExport, errorKind, type ExportPlan } from '@/features/admin/export/export-data';
import { parseExportRequest, searchRecord } from '@/features/admin/export/schemas';
import { EXPORT_MAX_ROWS, isExportTable } from '@/features/admin/export/tables';
import { can } from '@/server/auth/permissions';
import { requireAdminForRoute } from '@/server/auth/require-admin';
import type { AdminContext } from '@/server/auth/types';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';
import { clientIp } from '@/server/blocklist/request';
import { getContainer } from '@/server/container';
import { getQuota } from '@/server/container-light';
import { CSV_BOM, csvFileName, csvHeaderLine, csvRowLine } from '@/server/export/csv';

// GET /api/admin/export/{sessions|pages|countries|sources}?{the screen's params}
// (08-tables.md "CSV export", phase 3.10).
//
//   block check → same-origin → requireAdmin('export:csv') → table allowlist
//   → zod params → plan (count + read-budget check) → audit `export.csv`
//   → stream CSV (BOM, header, ≤ 5,000 rows)
//
// `&preview=1` stops after the plan and answers `{ ok, rows, total, … }` for
// the confirm dialog ("Export 1,902 sessions?"). The audit row is written
// before any data leaves: if it cannot be written, nothing is exported.

const NO_STORE = 'private, no-store';

type ErrorCode = 'cross_site' | 'unknown_table' | 'budget' | 'internal';

function fail(status: number, error: ErrorCode, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: false, error, message, ...extra }, { status, headers: { 'Cache-Control': NO_STORE } });
}

/**
 * Exports start from the admin's own pages (fetch → `same-origin`) or a typed
 * URL (`none`). A cross-site page could otherwise make a signed-in admin's
 * browser spend reads and write audit rows.
 */
function isCrossSite(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site !== null && site !== 'same-origin' && site !== 'none';
}

const BUDGET_MESSAGE = "Today's read budget can't cover this export. Try a shorter range or tomorrow.";

function stream(plan: ExportPlan): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let rows: AsyncIterator<unknown> | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(CSV_BOM + csvHeaderLine(plan.columns)));
    },
    async pull(controller) {
      rows ??= plan.rows()[Symbol.asyncIterator]();
      try {
        // Up to 100 lines per chunk: one sessions page, few enqueues.
        let chunk = '';
        for (let i = 0; i < 100; i += 1) {
          const next = await rows.next();
          if (next.done) {
            if (chunk) controller.enqueue(encoder.encode(chunk));
            controller.close();
            return;
          }
          chunk += csvRowLine(plan.columns, next.value as never);
        }
        controller.enqueue(encoder.encode(chunk));
      } catch (error) {
        // Mid-file failure (read cap reached, Firestore down): the download
        // fails in the browser rather than ending as a short "complete" file.
        console.error(`[admin] export: ${plan.table} stream failed`, errorKind(error));
        controller.error(error);
      }
    },
    async cancel() {
      await rows?.return?.();
    },
  });
}

async function audit(ctx: AdminContext, plan: ExportPlan, request: NextRequest): Promise<void> {
  await getContainer().audit.record({
    ctx,
    action: 'export.csv',
    target: { type: 'table', id: plan.table },
    after: {
      table: plan.table,
      filters: plan.filters,
      rows: plan.rowCount,
      total: plan.total,
      ...(plan.ipMasked === null ? {} : { ipMasked: plan.ipMasked }),
    },
    request: { ip: clientIp(request.headers), userAgent: request.headers.get('user-agent') },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ table: string }> }): Promise<Response> {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  if (isCrossSite(request)) return fail(403, 'cross_site', 'Start exports from the admin panel.');

  const auth = await requireAdminForRoute('export:csv');
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { table } = await params;
  if (!isExportTable(table)) return fail(404, 'unknown_table', 'There is no export for this table.');

  const search = request.nextUrl.searchParams;
  const exportRequest = parseExportRequest(table, searchRecord(search));
  const result = await planExport(exportRequest, { canSeeIp: can(ctx.role, 'ip:read') });
  if (result.state === 'budget') return fail(429, 'budget', BUDGET_MESSAGE);
  if (result.state === 'error') {
    return fail(500, 'internal', "Couldn't prepare this export. Try again.", { errorId: result.errorId });
  }
  const { plan } = result;

  if (search.get('preview') === '1') {
    return Response.json(
      {
        ok: true,
        table: plan.table,
        rows: plan.rowCount,
        total: plan.total,
        limit: EXPORT_MAX_ROWS,
        from: plan.range.from,
        to: plan.range.to,
      },
      { headers: { 'Cache-Control': NO_STORE } },
    );
  }

  try {
    await audit(ctx, plan, request);
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error(`[admin] export: audit write failed ${errorId}`, errorKind(error));
    return fail(500, 'internal', "Couldn't start this export. Try again.", { errorId });
  }
  // A sessions export can count up to 5,000 reads: write them to the daily counter soon.
  after(() => getQuota().flush());

  const fileName = csvFileName(plan.fileParts, plan.range.from, plan.range.to);
  return new Response(stream(plan), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': NO_STORE,
      'X-Content-Type-Options': 'nosniff',
      'X-Export-Rows': String(plan.rowCount),
      'X-Export-Total': String(plan.total),
    },
  });
}
