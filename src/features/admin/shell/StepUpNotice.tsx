'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { SECONDARY_BUTTON } from '@/shared/ui/data-table/styles';

type StepUpNoticeProps = {
  /** The signed-in admin's own email: the link goes there (not editable). */
  email: string | null;
  /** From the action's `step_up_required` result. */
  authAgeSec?: number | null;
  /** "Closing a room", "Disabling a user". */
  what: string;
};

function age(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min`;
  if (sec < 172_800) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86_400)} d`;
}

/**
 * Inline step-up (01-auth.md "Step-up rule"): shown in place, inside the
 * confirm dialog, when an action answers `step_up_required`. Sends a
 * sign-in link to the admin's own email that returns to this page. The
 * action is not retried by itself. The Firebase client loads only on send.
 */
export default function StepUpNotice({ email, authAgeSec, what }: StepUpNoticeProps) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const signedIn = age(authAgeSec);

  const send = async () => {
    if (!email) return;
    setState('sending');
    try {
      const { sendMagicLink } = await import('@/shared/lib/firebase/client');
      await sendMagicLink(email, `${window.location.pathname}${window.location.search}`);
      setState('sent');
    } catch {
      setState('error');
    }
  };

  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2.5 text-sm">
      <p className="flex items-start gap-2 font-medium text-fg">
        <ShieldCheck aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
        Confirm it&apos;s you
      </p>
      <p className="text-fg-muted">
        {signedIn ? `You signed in ${signedIn} ago. ` : ''}
        {what} needs a sign-in from the last 15 minutes.
      </p>
      {state === 'sent' ? (
        <p className="text-fg-muted">
          We sent a link to <strong className="font-medium break-all text-fg">{email}</strong>. Open it on this device,
          then repeat the action.
        </p>
      ) : email ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={SECONDARY_BUTTON} onClick={send} disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Send sign-in link'}
          </button>
          {state === 'error' && <span className="text-xs text-danger-text">Could not send the link. Try again.</span>}
        </div>
      ) : (
        <p className="text-fg-muted">Sign out and sign in again, then repeat the action.</p>
      )}
    </div>
  );
}
