import type { Metadata } from 'next';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';
import DangerZone from '@/features/admin/settings/components/DangerZone';
import RolesSection from '@/features/admin/settings/components/RolesSection';
import SettingsForm from '@/features/admin/settings/components/SettingsForm';
import SettingsNav from '@/features/admin/settings/components/SettingsNav';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/features/admin/settings/constants';
import { getSettings, listAdminRoles } from '@/features/admin/settings/queries';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import { ForbiddenError } from '@/server/errors';

export const metadata: Metadata = { title: 'Settings' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function sectionOf(value: string | string[] | undefined): SettingsSection | null {
  const v = Array.isArray(value) ? value[0] : value;
  return (SETTINGS_SECTIONS as readonly string[]).includes(v ?? '') ? (v as SettingsSection) : null;
}

// 15-settings.md. Owner only: `settings:write` for the page and every save
// (moderators and viewers do not see it in the sidebar; the URL gets an
// in-shell 403). A page view, so no blocklist read here (T-27): the actions
// do their own check. Firestore: 1 read (settings) + 1 on a roles cache miss.
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  let ctx;
  try {
    ctx = await requireAdminPage('settings:write', '/admin/settings');
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return (
        <EmptyState size="page" titleAs="h1" title="Only owners can see this page" body="Ask an owner if you need a setting changed." />
      );
    }
    throw e;
  }
  const section = sectionOf((await searchParams).section);
  const [settings, roles] = await Promise.all([getSettings(), listAdminRoles()]);

  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-fg">Settings</h1>
        <p className="mt-1 text-sm text-fg-muted">Only owners can see this page.</p>
      </header>
      <div className="lg:grid lg:grid-cols-[180px_minmax(0,720px)] lg:gap-8">
        <SettingsNav initial={section} />
        <div className="flex min-w-0 flex-col gap-8 pb-16">
          {settings.state === 'ok' ? (
            // Keyed by updated_at: after a save or a conflict reload, the form restarts from the stored values.
            <SettingsForm key={settings.settings.updatedAt ?? 'defaults'} initial={settings.settings} />
          ) : (
            <section aria-labelledby="tracking-heading" id="tracking" className="scroll-mt-20">
              <h2 id="tracking-heading" className="sr-only">
                Tracking and retention
              </h2>
              <ErrorState size="panel" title="Could not load settings." reason="Retry in a moment." errorId={settings.errorId} />
            </section>
          )}
          <RolesSection roles={roles} selfUid={ctx.uid} canManage={can(ctx.role, 'roles:write')} adminEmail={ctx.email} />
          <DangerZone
            rawRetentionDays={settings.state === 'ok' ? settings.settings.rawRetentionDays : null}
            ipRetentionDays={settings.state === 'ok' ? settings.settings.ipRetentionDays : null}
            canExport={can(ctx.role, 'export:csv')}
          />
        </div>
      </div>
    </>
  );
}
