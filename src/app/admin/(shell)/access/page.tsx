import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Info } from 'lucide-react';
import BlocksTable from '@/features/admin/access/components/BlocksTable';
import { listBlocks, type BlocksPage } from '@/features/admin/access/queries';
import { accessParamsSchema } from '@/features/admin/access/schemas';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import { clientCountry, clientIp } from '@/server/blocklist/request';
import { FIRST_PAGE_CURSOR } from '@/shared/ui/data-table/url-state';

export const metadata: Metadata = { title: 'Access control' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// 10-access-control.md. A page view, so no blocklist read here (T-27):
// the actions on this screen do their own check.
export default async function AccessPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAdminPage('blocks:read', '/admin/access');
  const raw = await searchParams;
  const params = accessParamsSchema.parse({
    status: first(raw.status),
    type: first(raw.type),
    q: first(raw.q) || undefined,
    cursor: first(raw.cursor) || undefined,
  });

  let data: BlocksPage | null = null;
  let error: { reason: string; errorId?: string } | undefined;
  try {
    data = await listBlocks(ctx, params);
  } catch (e) {
    const errorId = crypto.randomUUID();
    console.error(`[admin] access list failed ${errorId}`, e);
    error = { reason: 'The block list did not load. Try again in a moment.', errorId };
  }

  const h = await headers();
  const actor = { uid: ctx.uid, ip: clientIp(h), country: clientCountry(h) };

  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-fg">Access control</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Blocked visitors can&apos;t upload, send or download within 60 s. Pages still open.
        </p>
        <p className="mt-3 flex items-start gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          <Info aria-hidden="true" strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
          Blocks stop actions like uploads, messages and downloads. Blocked visitors can still open pages, and anyone
          with a live room code can still read that room.
        </p>
      </header>
      <NuqsAdapter>
        <BlocksTable
          rows={data?.rows ?? []}
          counts={data?.counts ?? null}
          status={params.status}
          type={params.type ?? null}
          page={{ prevCursor: params.cursor ? FIRST_PAGE_CURSOR : null, nextCursor: data?.nextCursor ?? null }}
          canWrite={can(ctx.role, 'blocks:write')}
          canSearch={can(ctx.role, 'ip:read')}
          actor={actor}
          error={error}
        />
      </NuqsAdapter>
    </>
  );
}
