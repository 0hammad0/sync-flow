import Link from 'next/link';
import ErrorState from '@/shared/ui/ErrorState';
import RoleBadge from '@/features/admin/users/components/RoleBadge';
import type { RolesLoad } from '../queries';

/**
 * Who is an admin (15-settings.md "Roles"), from the `admin_config/roles`
 * index. Read only here: role changes stay on each user's page, where
 * `setUserRole` (`roles:write`, `role.set` audit) already lives, so there is
 * one place that changes claims.
 */
export default function RolesSection({ roles, selfUid, canManage }: { roles: RolesLoad; selfUid: string; canManage: boolean }) {
  return (
    <section id="roles" aria-labelledby="roles-heading" className="flex scroll-mt-20 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="roles-heading" className="text-[15px] font-semibold text-fg">
          Roles
        </h2>
        {canManage && (
          <Link href="/admin/users?filter=admins" className="text-sm font-medium text-brand-text hover:underline">
            Manage on Users
          </Link>
        )}
      </div>
      {roles.state === 'error' ? (
        <ErrorState size="inline" title="Could not load the admin list." reason="Retry in a moment." errorId={roles.errorId} />
      ) : roles.admins.length === 0 ? (
        <p className="text-sm text-fg-muted">Admin list not built yet. Roles granted by script appear after their next change.</p>
      ) : (
        <ul className="divide-y divide-edge rounded-lg border border-edge">
          {roles.admins.map((admin) => (
            <li key={admin.uid} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-fg">{admin.email ?? admin.uid}</span>
              <RoleBadge role={admin.role} />
              {admin.uid === selfUid ? (
                <span className="text-xs text-fg-muted">(you)</span>
              ) : (
                canManage && (
                  <Link
                    href={`/admin/users/${encodeURIComponent(admin.uid)}`}
                    className="text-xs font-medium text-brand-text hover:underline"
                    aria-label={`Change role for ${admin.email ?? admin.uid}`}
                  >
                    Change
                  </Link>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
