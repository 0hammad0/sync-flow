import type { Metadata } from 'next';
import EmptyState from '@/shared/ui/EmptyState';
import NoDataYet from '@/shared/ui/illustrations/NoDataYet';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';

export const metadata: Metadata = { title: 'Overview' };

// Placeholder until phase 3 (analytics). Keeps the shell testable end to end.
export default async function OverviewPage() {
  await requireAdminPage('analytics:read', '/admin');

  return (
    <>
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-fg">Overview</h1>
        <p className="mt-1 text-sm text-fg-muted">Visitors, pages and storage at a glance.</p>
      </header>
      <EmptyState
        size="page"
        illustration={<NoDataYet />}
        title="No visitor data yet"
        body="Data arrives in phase 3, when visitor tracking is built."
      />
    </>
  );
}
