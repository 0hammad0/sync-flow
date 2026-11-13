'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import { ArrowLeft, LogOut, MonitorSmartphone } from 'lucide-react';
import { signOut } from 'firebase/auth';
import Badge from '@/shared/ui/Badge';
import type { ConfirmResult } from '@/shared/ui/ConfirmDialog';
import { clientAuth } from '@/shared/lib/firebase/client';
import { clearAuthHint } from '@/shared/lib/auth-state';
import type { AdminRole } from '@/server/auth/types';
import { ADMIN_SIGN_IN, initialsFor, roleLabel, signInHref } from './account';
import { ICON_BUTTON, SIDEBAR_ROW } from './styles';

// Loaded on first "Sign out everywhere", not with the shell.
const ConfirmDialog = dynamic(() => import('@/shared/ui/ConfirmDialog'), { ssr: false });

type AccountMenuProps = {
  email: string | null;
  role: AdminRole;
  /** `sidebar`: full row (avatar, email, role). `compact`: avatar button for the phone top bar. */
  variant: 'sidebar' | 'compact';
};

const ITEM =
  'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm select-none pointer-coarse:h-11 data-[highlighted]:bg-surface-2 focus-visible:-outline-offset-2!';

type SignOutResult = { ok: true } | { ok: false; message: string };

/** Persistent error toast. sonner loads lazily (LazyToaster), so import it on use. */
async function toastError(title: string, description: string) {
  const { toast } = await import('sonner');
  toast.error(title, { description, duration: Infinity });
}

/**
 * Ends this browser's admin session (`DELETE /api/session`), or every session
 * with `?everywhere=1`. Also signs the Firebase client out, like the public
 * header does, so the site and the sign-in page see a signed-out user.
 */
async function endSession(everywhere: boolean): Promise<SignOutResult> {
  let response: Response;
  try {
    response = await fetch(everywhere ? '/api/session?everywhere=1' : '/api/session', { method: 'DELETE' });
  } catch {
    return { ok: false, message: 'The connection dropped. You are still signed in.' };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: everywhere
        ? "Other devices couldn't be signed out. You are still signed in."
        : 'The server hit an error. You are still signed in.',
    };
  }
  try {
    await signOut(clientAuth());
  } catch {
    // The session cookie is gone, which is what protects /admin.
  }
  clearAuthHint();
  return { ok: true };
}

function Avatar({ email, className = '' }: { email: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-medium text-fg-muted ${className}`}
    >
      {initialsFor(email)}
    </span>
  );
}

export default function AccountMenu({ email, role, variant }: AccountMenuProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const shownEmail = email ?? 'No email on this account';
  const label = `Account: ${shownEmail}, ${roleLabel(role)}`;

  const signOutHere = async () => {
    const result = await endSession(false);
    if (!result.ok) {
      void toastError("Couldn't sign out", result.message);
      return;
    }
    router.replace(ADMIN_SIGN_IN);
  };

  const signOutEverywhere = async (): Promise<ConfirmResult> => {
    const result = await endSession(true);
    if (!result.ok) {
      void toastError("Couldn't sign out everywhere", result.message);
      return { ok: false, error: 'sign_out_failed', message: result.message };
    }
    router.replace(signInHref(ADMIN_SIGN_IN, '', 'everywhere'));
    return { ok: true };
  };

  const trigger =
    variant === 'sidebar' ? (
      <button type="button" aria-label={label} className={`${SIDEBAR_ROW} pl-3`}>
        <Avatar email={email} />
        <span className="admin-sb-label flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-left font-mono text-xs" title={shownEmail}>
            {shownEmail}
          </span>
          <Badge tone={role === 'owner' ? 'brand' : 'neutral'}>{roleLabel(role)}</Badge>
        </span>
      </button>
    ) : (
      <button type="button" aria-label={label} className={`${ICON_BUTTON} -mr-1`}>
        <Avatar email={email} className="size-7" />
      </button>
    );

  return (
    <>
      <MenuPrimitive.Root>
        <MenuPrimitive.Trigger asChild>{trigger}</MenuPrimitive.Trigger>
        <MenuPrimitive.Portal>
          <MenuPrimitive.Content
            side={variant === 'sidebar' ? 'right' : 'bottom'}
            align="end"
            sideOffset={8}
            collisionPadding={16}
            className="ui-pop z-50 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-edge bg-surface p-1 text-fg shadow-[var(--shadow-float)]"
          >
            <div className="flex items-center gap-2 px-2 pt-1.5 pb-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted" title={shownEmail}>
                {shownEmail}
              </span>
              <Badge tone={role === 'owner' ? 'brand' : 'neutral'}>{roleLabel(role)}</Badge>
            </div>
            <MenuPrimitive.Separator className="-mx-1 my-1 h-px bg-edge" />
            <MenuPrimitive.Item asChild className={ITEM}>
              <Link href="/">
                <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-fg-muted" />
                Back to site
              </Link>
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className="-mx-1 my-1 h-px bg-edge" />
            <MenuPrimitive.Item className={ITEM} onSelect={() => void signOutHere()}>
              <LogOut aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-fg-muted" />
              Sign out
            </MenuPrimitive.Item>
            <MenuPrimitive.Item className={`${ITEM} text-danger-text`} onSelect={() => setConfirmOpen(true)}>
              <MonitorSmartphone aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
              Sign out everywhere…
            </MenuPrimitive.Item>
          </MenuPrimitive.Content>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Root>
      {confirmOpen && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Sign out everywhere?"
          consequence="Every device signed in to this account is signed out, including this one."
          confirmLabel="Sign out everywhere"
          tone="danger"
          onConfirm={signOutEverywhere}
        />
      )}
    </>
  );
}
