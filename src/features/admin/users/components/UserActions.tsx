'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import type { ActionResult } from '@/server/errors';
import { blockedError } from '@/shared/lib/blocked';
import ConfirmDialog, { type ConfirmResult } from '@/shared/ui/ConfirmDialog';
import DropdownMenu from '@/shared/ui/DropdownMenu';
import { SECONDARY_BUTTON } from '@/shared/ui/data-table/styles';
import StepUpNotice from '@/features/admin/shell/StepUpNotice';
import { disableUser, enableUser, revokeUserSessions, setUserRole, type UserActionData } from '../actions';
import { OWNER_CONFIRM, ROLE_CHOICES, type RoleChoice } from '../constants';
import type { UserDetailDto } from '../types';

async function toast(kind: 'success' | 'error', title: string, description?: string) {
  const { toast: t } = await import('sonner');
  t[kind](title, description ? { description } : undefined);
}

const ROLE_LABELS: Record<RoleChoice, string> = { none: 'No role', viewer: 'Viewer', moderator: 'Moderator', owner: 'Owner' };

type Pending = { kind: 'disable' } | { kind: 'revoke' } | { kind: 'role'; role: RoleChoice };

export type UserActionPermissions = { disable: boolean; revoke: boolean; roles: boolean };

type UserActionsProps = {
  user: Pick<UserDetailDto, 'uid' | 'email' | 'role' | 'disabled'>;
  can: UserActionPermissions;
  adminEmail: string | null;
};

function message(result: Exclude<ActionResult<UserActionData>, { ok: true }>): string {
  if (result.error === 'blocked') return blockedError(result) ?? "You can't do this right now.";
  if (result.message) return result.message;
  if (result.error === 'forbidden') return 'Your role cannot do this.';
  if (result.error === 'invalid') return Object.values(result.fields ?? {})[0]?.[0] ?? 'Check the form and try again.';
  return `Something went wrong. Try again.${result.errorId ? ` Error id ${result.errorId}.` : ''}`;
}

function dialogCopy(p: Pending, label: string) {
  if (p.kind === 'disable') {
    return { title: `Disable ${label}?`, consequence: 'They are signed out and cannot sign in. Their files stay.', confirm: 'Disable user' };
  }
  if (p.kind === 'revoke') {
    return { title: `Sign out ${label} everywhere?`, consequence: 'All their devices are signed out. They can sign in again.', confirm: 'Sign out everywhere' };
  }
  if (p.role === 'owner') {
    return {
      title: `Make ${label} an owner?`,
      consequence: `Owners can do everything, including changing roles. Type ${OWNER_CONFIRM} to confirm.`,
      confirm: 'Make owner',
    };
  }
  return {
    title: p.role === 'none' ? `Remove ${label}'s role?` : `Make ${label} a ${ROLE_LABELS[p.role].toLowerCase()}?`,
    consequence: 'Their sessions end so the new role applies at their next sign-in.',
    confirm: p.role === 'none' ? 'Remove role' : 'Change role',
  };
}

/**
 * Disable / enable, sign out everywhere, set role (13-users.md "Actions").
 * Only rendered for someone else's account: the server refuses self-actions too.
 */
export default function UserActions({ user, can, adminEmail }: UserActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [stepUp, setStepUp] = useState<{ authAgeSec: number | null } | null>(null);
  const [enabling, startEnable] = useTransition();
  const label = user.email ?? user.uid;

  const done = (title: string) => {
    void toast('success', title);
    router.refresh();
  };

  const confirm = async (p: Pending): Promise<ConfirmResult> => {
    const call =
      p.kind === 'disable'
        ? disableUser({ uid: user.uid })
        : p.kind === 'revoke'
          ? revokeUserSessions({ uid: user.uid })
          : setUserRole({ uid: user.uid, role: p.role, confirm: p.role === 'owner' ? OWNER_CONFIRM : undefined });
    const result = await call.catch((e: unknown) => ({ ok: false as const, error: 'internal' as const, message: blockedError(e) ?? 'Check your connection and try again.' }));
    if (result.ok) {
      setStepUp(null);
      done(p.kind === 'disable' ? `Disabled ${label}` : p.kind === 'revoke' ? `Signed out ${label} everywhere` : `Role updated for ${label}`);
      return { ok: true };
    }
    if (result.error === 'step_up_required') {
      setStepUp({ authAgeSec: 'authAgeSec' in result ? (result.authAgeSec ?? null) : null });
      return { ok: false, error: result.error, message: 'Sign in again to finish.' };
    }
    return { ok: false, error: result.error, message: message(result) };
  };

  const enable = () =>
    startEnable(async () => {
      const result = await enableUser({ uid: user.uid }).catch(() => null);
      if (result?.ok) done(`Enabled ${label}`);
      else void toast('error', `Couldn't enable ${label}`, result ? message(result) : 'Check your connection and try again.');
    });

  const copy = pending ? dialogCopy(pending, label) : null;

  return (
    <div className="flex flex-wrap gap-2">
      {can.disable &&
        (user.disabled ? (
          <button type="button" className={SECONDARY_BUTTON} onClick={enable} disabled={enabling}>
            {enabling ? 'Enabling…' : 'Enable'}
          </button>
        ) : (
          <button type="button" className={SECONDARY_BUTTON} onClick={() => setPending({ kind: 'disable' })}>
            Disable
          </button>
        ))}
      {can.revoke && (
        <button type="button" className={SECONDARY_BUTTON} onClick={() => setPending({ kind: 'revoke' })}>
          Sign out everywhere
        </button>
      )}
      {can.roles && (
        <DropdownMenu
          align="end"
          items={ROLE_CHOICES.map((role) => ({
            type: 'item' as const,
            label: `${ROLE_LABELS[role]}${(user.role ?? 'none') === role ? ' (current)' : ''}`,
            disabled: (user.role ?? 'none') === role,
            onSelect: () => setPending({ kind: 'role', role }),
          }))}
          trigger={
            <button type="button" className={SECONDARY_BUTTON}>
              Set role
              <ChevronDown aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
            </button>
          }
        />
      )}
      {pending && copy && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setPending(null);
              setStepUp(null);
            }
          }}
          title={copy.title}
          consequence={copy.consequence}
          confirmLabel={copy.confirm}
          tone={pending.kind === 'role' && pending.role !== 'owner' ? 'default' : 'danger'}
          typeToConfirm={pending.kind === 'role' && pending.role === 'owner' ? OWNER_CONFIRM : undefined}
          onConfirm={() => confirm(pending)}
        >
          {stepUp && <StepUpNotice email={adminEmail} authAgeSec={stepUp.authAgeSec} what="This action" />}
        </ConfirmDialog>
      )}
    </div>
  );
}
