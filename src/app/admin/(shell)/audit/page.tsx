import type { Metadata } from 'next';
import { Info } from 'lucide-react';
import AuditTable from '@/features/admin/audit/components/AuditTable';
import { listAuditEntries } from '@/features/admin/audit/queries';
import { auditParamsSchema } from '@/features/admin/audit/schemas';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { FIRST_PAGE_CURSOR } from '@/shared/ui/data-table/url-state';

export const metadata: Metadata = { title: 'Audit log' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// 11-audit-log.md. Read only: no control on this page (or anywhere) edits or
// deletes an entry. A moderator's own-rows scope is set in the query
// (listAuditEntries → auditScope), never by the UI.
export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAdminPage('audit:read', '/admin/audit');
  const raw = await searchParams;
  const params = auditParamsSchema.parse({
    range: first(raw.range),
    actor: first(raw.actor) || undefined,
    action: first(raw.action) || undefined,
    q: first(raw.q) || undefined,
    cursor: first(raw.cursor) || undefined,
  });

  const result = await listAuditEntries(ctx, params);
  const { scope } = result;
  const isOwner = ctx.role === 'owner';
  const actorRow = result.state === 'ok' ? result.rows.find((r) => r.actorUid === scope.actorUid) : undefined;

  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-fg">Audit log</h1>
        <p className="mt-1 text-sm text-fg-muted">Every admin action. Entries cannot be changed or deleted.</p>
        {scope.ownOnly && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-fg-muted">
            <Info aria-hidden="true" strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
            You see your own actions only.
          </p>
        )}
        {isOwner && scope.ignored.length > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-fg-muted">
            <Info aria-hidden="true" strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
            One filter at a time: {scope.targetId ? 'the target search' : 'the action filter'} is applied, the others are
            ignored.
          </p>
        )}
      </header>
      <AuditTable
        rows={result.state === 'ok' ? result.rows : []}
        range={params.range}
        action={scope.action}
        actor={
          isOwner && scope.actorUid
            ? { uid: scope.actorUid, label: actorRow?.actorEmail ?? `${scope.actorUid.slice(0, 8)}…` }
            : null
        }
        page={{
          prevCursor: params.cursor ? FIRST_PAGE_CURSOR : null,
          nextCursor: result.state === 'ok' ? result.nextCursor : null,
        }}
        canSearch={isOwner}
        canFilterActor={isOwner}
        error={
          result.state === 'budget'
            ? { title: 'Read budget used for today.', reason: 'Firestore reads for admin pages are paused until midnight Pacific.' }
            : result.state === 'error'
              ? { title: 'Could not load the audit log.', reason: 'Firestore did not answer. Try again in a moment.', errorId: result.errorId }
              : undefined
        }
      />
    </>
  );
}
