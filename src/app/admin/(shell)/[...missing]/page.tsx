import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';

// Any /admin/** URL with no page of its own gets the in-shell 404
// (06-states.md 6.7) instead of the public one. Static routes such as
// /admin/sign-in always win over this catch-all.
export default async function MissingAdminPage({ params }: { params: Promise<{ missing: string[] }> }) {
  const { missing } = await params;
  await requireAdminPage('analytics:read', `/admin/${missing.map(encodeURIComponent).join('/')}`);
  notFound();
}
