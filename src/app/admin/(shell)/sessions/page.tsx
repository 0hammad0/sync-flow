import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Info } from 'lucide-react';
import { listSessions, resolveAnalyticsRange } from '@/features/admin/analytics/queries';
import { formatDay, utcDayOf, type ResolvedRange } from '@/features/admin/analytics/range';
import { parseRangeParams } from '@/features/admin/analytics/range-schema';
import SessionsSkeleton from '@/features/admin/sessions/components/SessionsSkeleton';
import SessionsTable from '@/features/admin/sessions/components/SessionsTable';
import {
  FILTER_KEY_LABELS,
  SEARCH_PROBLEM_TEXT,
  pageCursors,
  parseSessionsParams,
  toSessionFilter,
  type SessionsParams,
} from '@/features/admin/sessions/schemas';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import type { AdminContext } from '@/server/auth/types';
import { clientCountry, clientIp } from '@/server/blocklist/request';

export const metadata: Metadata = { title: 'Sessions' };

/** Request time, for "today" in the Started column (server and client then agree). */
const todayUtc = () => utcDayOf(Date.now());

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// 04-sessions.md. A page view, so no blocklist read here (T-27); the block
// action does its own check. Rows are masked on the server for roles without
// `ip:read`, so a full IP never reaches their HTML or RSC payload.
export default async function SessionsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAdminPage('analytics:read', '/admin/sessions');
  const raw = await searchParams;
  const canSeeIp = can(ctx.role, 'ip:read');
  const params = parseSessionsParams(raw, { canSeeIp });
  const range = await resolveAnalyticsRange(parseRangeParams(raw), 'sessions');

  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-fg">Sessions</h1>
        <p className="mt-1 text-sm text-fg-muted">Every visit in the selected range, newest first.</p>
        <Notices params={params} range={range} />
      </header>
      <NuqsAdapter>
        <Suspense fallback={<SessionsSkeleton />}>
          <SessionsPanel ctx={ctx} params={params} range={range} canSeeIp={canSeeIp} />
        </Suspense>
      </NuqsAdapter>
    </>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mt-3 flex items-start gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-fg-muted">
      <Info aria-hidden="true" strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Notices({ params, range }: { params: SessionsParams; range: ResolvedRange }) {
  const kept = params.filter ? (params.filter.kind === 'ip' || params.filter.kind === 'user' ? 'search' : params.filter.kind) : null;
  return (
    <>
      {params.searchProblem && <Notice>{SEARCH_PROBLEM_TEXT[params.searchProblem]}</Notice>}
      {params.ignored.length > 0 && (
        <Notice>
          One filter works at a time. {kept ? `Showing the ${kept} only` : 'No filter applied'}; the{' '}
          {params.ignored.map((key) => FILTER_KEY_LABELS[key]).join(' and ')} filter was ignored.
        </Notice>
      )}
      {params.filter?.kind === 'ip' && (
        <Notice>IP search looks at every day, not just this range, and shows the newest 100 sessions.</Notice>
      )}
      {range.clamped && params.filter?.kind !== 'ip' && (
        <Notice>Older sessions are deleted, so this range starts on {formatDay(range.from)}.</Notice>
      )}
    </>
  );
}

async function SessionsPanel({
  ctx,
  params,
  range,
  canSeeIp,
}: {
  ctx: AdminContext;
  params: SessionsParams;
  range: ResolvedRange;
  canSeeIp: boolean;
}) {
  const ipSearch = params.filter?.kind === 'ip' ? params.filter.value : null;
  const { cursor } = pageCursors(params.cursorStack, null);
  const result = await listSessions(
    { range, filter: toSessionFilter(params.filter), ip: ipSearch, cursor },
    { canSeeIp },
  );
  const ok = result.state === 'ok';
  const page = pageCursors(params.cursorStack, ok ? result.data.nextCursor : null);

  // Blocking needs the full IP: blocks:write roles all hold ip:read, but check both.
  const canBlock = canSeeIp && can(ctx.role, 'blocks:write');
  const h = canBlock ? await headers() : null;
  const actor = h ? { uid: ctx.uid, ip: clientIp(h), country: clientCountry(h) } : null;

  return (
    <SessionsTable
      rows={ok ? result.data.rows : []}
      total={ok ? result.data.total : null}
      page={{ prevCursor: page.prevCursor, nextCursor: page.nextCursor }}
      filter={params.filter}
      today={todayUtc()}
      canSeeIp={canSeeIp}
      canBlock={canBlock}
      canExport={can(ctx.role, 'export:csv')}
      canOpenUsers={can(ctx.role, 'users:read')}
      actor={actor}
      error={
        result.state === 'budget'
          ? {
              title: 'Read budget used for today.',
              reason: 'Firestore reads for admin pages are paused until midnight Pacific, so chat keeps working.',
            }
          : result.state === 'error'
            ? { title: 'Could not load sessions.', reason: 'Firestore did not answer. Try again in a moment.', errorId: result.errorId }
            : undefined
      }
    />
  );
}
