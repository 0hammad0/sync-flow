import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSessionDetail, SESSION_ID_RE } from '@/features/admin/analytics/queries';
import SessionHeader, { BackToSessions } from '@/features/admin/sessions/components/SessionHeader';
import SessionTimeline from '@/features/admin/sessions/components/SessionTimeline';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import { clientCountry, clientIp } from '@/server/blocklist/request';
import { buttonClass } from '@/shared/ui/button-styles';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';
import NotFound from '@/shared/ui/illustrations/NotFound';

export const metadata: Metadata = { title: 'Session' };

type Params = Promise<{ sessionId: string }>;

function Gone() {
  return (
    <EmptyState
      size="page"
      titleAs="h1"
      illustration={<NotFound />}
      title="Session not found."
      body="It may be older than 90 days. Sessions are deleted after that."
      action={
        <Link href="/admin/sessions" className={buttonClass()}>
          Back to sessions
        </Link>
      }
    />
  );
}

// 04-sessions.md "Detail". One doc read holds the whole timeline. The IP is
// masked on the server for roles without `ip:read`.
export default async function SessionPage({ params }: { params: Params }) {
  const { sessionId } = await params;
  const ctx = await requireAdminPage('analytics:read', `/admin/sessions/${encodeURIComponent(sessionId)}`);
  // Not 32 hex characters: no DB call.
  if (!SESSION_ID_RE.test(sessionId)) notFound();

  const canSeeIp = can(ctx.role, 'ip:read');
  const result = await getSessionDetail(sessionId, { canSeeIp });

  if (result.state === 'budget') {
    return (
      <div className="max-w-5xl">
        <BackToSessions />
        <EmptyState
          size="panel"
          titleAs="h1"
          title="Read budget used for today."
          body="Firestore reads for admin pages are paused until midnight Pacific, so chat keeps working."
        />
      </div>
    );
  }
  if (result.state === 'error') {
    return (
      <div className="max-w-5xl">
        <BackToSessions />
        <ErrorState titleAs="h1" title="Could not load this session." reason="Firestore did not answer. Try again in a moment." errorId={result.errorId} />
      </div>
    );
  }
  if (!result.data) return <Gone />;

  const session = result.data;
  const canBlock = canSeeIp && can(ctx.role, 'blocks:write');
  const h = canBlock ? await headers() : null;
  const actor = h ? { uid: ctx.uid, ip: clientIp(h), country: clientCountry(h) } : null;

  return (
    <div className="max-w-5xl">
      <BackToSessions />
      <SessionHeader session={session} canBlock={canBlock} canOpenUsers={can(ctx.role, 'users:read')} actor={actor} />
      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="mb-3 text-base font-semibold text-fg">
          Timeline
        </h2>
        <SessionTimeline
          pages={session.pages}
          startedAt={session.startedAt}
          lastSeenAt={session.lastSeenAt}
          pageCapReached={session.pageCapReached}
        />
      </section>
    </div>
  );
}
