import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import { getLive } from '@/features/admin/analytics/queries';
import LiveSkeleton, { LiveHeader } from '@/features/admin/live/components/LiveSkeleton';
import LiveView from '@/features/admin/live/components/LiveView';
import RetryButton from '@/features/admin/overview/components/RetryButton';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import type { AdminContext } from '@/server/auth/types';
import { clientCountry, clientIp } from '@/server/blocklist/request';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';

export const metadata: Metadata = { title: 'Live' };

// Live (03-live.md). The first paint has real data from the server (cached
// 30 s in the data layer); the client then polls /api/admin/live. Ignores
// `?range=` (the top-bar picker is hidden here). IPs are masked on the server
// for roles without `ip:read`.
export default async function LivePage() {
  const ctx = await requireAdminPage('analytics:read', '/admin/live');
  return (
    <Suspense fallback={<LiveSkeleton />}>
      <LiveLoader ctx={ctx} />
    </Suspense>
  );
}

async function LiveLoader({ ctx }: { ctx: AdminContext }) {
  const canSeeIp = can(ctx.role, 'ip:read');
  const result = await getLive({ canSeeIp });
  if (result.state === 'ok') {
    // Blocking needs the full IP: same rule as the sessions screens.
    const canBlock = canSeeIp && can(ctx.role, 'blocks:write');
    const h = canBlock ? await headers() : null;
    const blockActor = h ? { uid: ctx.uid, ip: clientIp(h), country: clientCountry(h) } : null;
    return <LiveView initial={result.data} selfUid={ctx.uid} blockActor={blockActor} />;
  }
  return (
    <>
      <LiveHeader />
      {result.state === 'budget' ? (
        <EmptyState
          size="page"
          title="Today's read budget is used up"
          body="Live is paused until 00:00 UTC, so chat keeps working."
        />
      ) : (
        <ErrorState
          size="page"
          title="Couldn't load live visitors"
          reason="The server hit an error. It has been logged."
          errorId={result.errorId}
          action={<RetryButton />}
        />
      )}
    </>
  );
}
