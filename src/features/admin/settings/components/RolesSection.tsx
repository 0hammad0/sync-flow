'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Plus } from 'lucide-react';
import type { ActionResult } from '@/server/errors';
import { blockedError } from '@/shared/lib/blocked';
import AdminButton from '@/shared/ui/AdminButton';
import ConfirmDialog, { type ConfirmResult } from '@/shared/ui/ConfirmDialog';
import DropdownMenu from '@/shared/ui/DropdownMenu';
import ErrorState from '@/shared/ui/ErrorState';
import Input from '@/shared/ui/Input';
import Select from '@/shared/ui/Select';
import { buttonClass } from '@/shared/ui/button-styles';
import StepUpNotice from '@/features/admin/shell/StepUpNotice';
import { rateLimitedNotice } from '@/features/admin/rate-limited';
import RoleBadge from '@/features/admin/users/components/RoleBadge';
import { setUserRole } from '@/features/admin/users/actions';
import { OWNER_CONFIRM } from '@/features/admin/users/constants';
import { addAdmin, rebuildAdminIndex } from '../actions';
import { ADD_ADMIN_ROLES, type AddAdminRole } from '../constants';
import type { RolesLoad } from '../queries';
import type { AdminRoleDto } from '../types';

async function toast(kind: 'success' | 'error', title: string) {
  const { toast: t } = await import('sonner');
  t[kind](title);
}

const ROLE_LABELS: Record<AddAdminRole, string> = { viewer: 'Viewer', moderator: 'Moderator', owner: 'Owner' };

type Failure = Extract<ActionResult<unknown>, { ok: false }>;
type Pending = { kind: 'add' } | { kind: 'role'; admin: AdminRoleDto; role: AddAdminRole | 'none' };

function failureText(result: Failure): string {
  const limited = rateLimitedNotice(result);
  if (limited) return limited;
  if (result.error === 'blocked') return blockedError(result) ?? "You can't do this right now.";
  if (result.error === 'step_up_required') return 'Sign in again to finish.';
  if (result.message) return result.message;
  if (result.error === 'forbidden') return 'Only owners can change roles.';
  if (result.error === 'invalid') return Object.values(result.fields ?? {})[0]?.[0] ?? 'Check the form and try again.';
  return `Something went wrong. Try again.${result.errorId ? ` Error id ${result.errorId}.` : ''}`;
}

const networkFailure = (e: unknown): Failure => ({
  ok: false,
  error: 'internal',
  message: blockedError(e) ?? 'Check your connection and try again.',
});

function roleCopy(p: Extract<Pending, { kind: 'role' }>) {
  const label = p.admin.email ?? p.admin.uid;
  if (p.role === 'owner') {
    return {
      title: `Make ${label} an owner?`,
      consequence: `Owners can do everything, including changing roles. Type ${OWNER_CONFIRM} to confirm.`,
      confirm: 'Make owner',
    };
  }
  if (p.role === 'none') {
    return { title: `Remove ${label} as an admin?`, consequence: 'Their admin access ends now. Their account stays.', confirm: 'Remove admin' };
  }
  return {
    title: `Make ${label} a ${ROLE_LABELS[p.role].toLowerCase()}?`,
    consequence: 'Their sessions end so the new role applies at their next sign-in.',
    confirm: 'Change role',
  };
}

type Props = {
  roles: RolesLoad;
  selfUid: string;
  /** `can(role, 'roles:write')` (owner). */
  canManage: boolean;
  /** For the step-up notice. */
  adminEmail: string | null;
};

/**
 * Who is an admin (15-settings.md "Roles"), from the `admin_config/roles`
 * index. Owners add an admin by email, change a role, remove an admin
 * (`addAdmin` / `setUserRole`: `roles:write` + step-up, audit `role.set`),
 * and rebuild the index from the claims when it is missing or out of sync.
 * Your own row has no actions: the server refuses self-changes too.
 */
export default function RolesSection({ roles, selfUid, canManage, adminEmail }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [stepUp, setStepUp] = useState<{ authAgeSec: number | null } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AddAdminRole>('viewer');
  const [rebuilding, startRebuild] = useTransition();

  const close = () => {
    setPending(null);
    setStepUp(null);
  };

  const confirm = async (p: Pending): Promise<ConfirmResult> => {
    const result: ActionResult<unknown> =
      p.kind === 'add'
        ? await addAdmin({ email, role, confirm: role === 'owner' ? OWNER_CONFIRM : undefined }).catch(networkFailure)
        : await setUserRole({ uid: p.admin.uid, role: p.role, confirm: p.role === 'owner' ? OWNER_CONFIRM : undefined }).catch(
            networkFailure,
          );
    if (result.ok) {
      setStepUp(null);
      if (p.kind === 'add') {
        void toast('success', `${email.trim()} is now a ${ROLE_LABELS[role].toLowerCase()}`);
        setEmail('');
        setRole('viewer');
      } else {
        const label = p.admin.email ?? p.admin.uid;
        void toast('success', p.role === 'none' ? `Removed ${label} as an admin` : `Role updated for ${label}`);
      }
      router.refresh();
      return { ok: true };
    }
    if (result.error === 'step_up_required') {
      setStepUp({ authAgeSec: result.authAgeSec ?? null });
    }
    return { ok: false, error: result.error, message: failureText(result) };
  };

  const rebuild = () =>
    startRebuild(async () => {
      const result = await rebuildAdminIndex().catch(networkFailure);
      if (result.ok) {
        const { admins, added, removed, changed } = result.data;
        const fixes = added + removed + changed;
        void toast('success', fixes === 0 ? `Admin list is in sync (${admins} admins).` : `Admin list rebuilt: ${admins} admins, ${fixes} fixed.`);
        router.refresh();
      } else {
        void toast('error', failureText(result));
      }
    });

  const rebuildButton = canManage && (
    <AdminButton size="sm" onClick={rebuild} loading={rebuilding} loadingText="Rebuilding…">
      Rebuild from claims
    </AdminButton>
  );

  const roleDialog = pending?.kind === 'role' ? roleCopy(pending) : null;

  return (
    <section id="roles" aria-labelledby="roles-heading" className="flex scroll-mt-20 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="roles-heading" className="text-[15px] font-semibold text-fg">
          Roles
        </h2>
        {canManage && (
          <AdminButton size="sm" icon={Plus} onClick={() => setPending({ kind: 'add' })}>
            Add admin
          </AdminButton>
        )}
      </div>
      {roles.state === 'error' ? (
        <ErrorState size="inline" title="Could not load the admin list." reason="Retry in a moment." errorId={roles.errorId} />
      ) : roles.admins.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-fg-muted">Admin list not built yet.</p>
          {rebuildButton}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-edge rounded-lg border border-edge">
            {roles.admins.map((admin) => {
              const label = admin.email ?? admin.uid;
              return (
                <li key={admin.uid} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-fg">{label}</span>
                  <RoleBadge role={admin.role} />
                  {admin.uid === selfUid ? (
                    <span className="text-xs text-fg-muted">(you)</span>
                  ) : (
                    canManage && (
                      <div className="flex gap-2">
                        <DropdownMenu
                          align="end"
                          items={ADD_ADMIN_ROLES.map((r) => ({
                            type: 'item' as const,
                            label: `${ROLE_LABELS[r]}${admin.role === r ? ' (current)' : ''}`,
                            disabled: admin.role === r,
                            onSelect: () => setPending({ kind: 'role', admin, role: r }),
                          }))}
                          trigger={
                            <button type="button" className={buttonClass({ size: 'sm' })} aria-label={`Change role for ${label}`}>
                              Change
                              <ChevronDown aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
                            </button>
                          }
                        />
                        <AdminButton size="sm" onClick={() => setPending({ kind: 'role', admin, role: 'none' })} aria-label={`Remove ${label} as an admin`}>
                          Remove
                        </AdminButton>
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
          {canManage && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-fg-muted">Someone missing, or a role set by hand in the console?</p>
              {rebuildButton}
            </div>
          )}
        </>
      )}

      {pending?.kind === 'add' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          title="Add an admin?"
          consequence={
            role === 'owner'
              ? `Owners can do everything, including changing roles. Type ${OWNER_CONFIRM} to confirm.`
              : 'They get admin access at their next sign-in. They must have signed in once before.'
          }
          confirmLabel="Add admin"
          tone={role === 'owner' ? 'danger' : 'default'}
          typeToConfirm={role === 'owner' ? OWNER_CONFIRM : undefined}
          onConfirm={() => confirm(pending)}
        >
          <div className="flex flex-col gap-3">
            <Input
              label="Email"
              type="email"
              autoComplete="off"
              maxLength={320}
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Select<AddAdminRole>
              label="Role"
              value={role}
              onValueChange={setRole}
              options={ADD_ADMIN_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            />
            {stepUp && <StepUpNotice email={adminEmail} authAgeSec={stepUp.authAgeSec} what="Adding an admin" />}
          </div>
        </ConfirmDialog>
      )}

      {pending?.kind === 'role' && roleDialog && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          title={roleDialog.title}
          consequence={roleDialog.consequence}
          confirmLabel={roleDialog.confirm}
          tone={pending.role === 'owner' || pending.role === 'none' ? 'danger' : 'default'}
          typeToConfirm={pending.role === 'owner' ? OWNER_CONFIRM : undefined}
          onConfirm={() => confirm(pending)}
        >
          {stepUp && <StepUpNotice email={adminEmail} authAgeSec={stepUp.authAgeSec} what="This change" />}
        </ConfirmDialog>
      )}
    </section>
  );
}
