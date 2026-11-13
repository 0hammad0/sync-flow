'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { authErrorMessage, sendMagicLink } from '@/shared/lib/firebase/client';
import Button from '@/shared/ui/Button';
import Input from '@/shared/ui/Input';

const RESEND_COOLDOWN_S = 30;
// Catches obvious typos without a round trip; Firebase checks the rest.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/**
 * Admin magic-link form. Same Firebase path as /login (`sendMagicLink`); the
 * existing /auth/callback page finishes sign-in and lands on `next`.
 * Copy: docs/admin/03-features/01-auth.md ("States", "Validation").
 */
export default function AdminSignInForm({ next }: { next: string }) {
  const online = useOnline();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (sentTo) sentHeadingRef.current?.focus();
  }, [sentTo]);

  async function send(address: string) {
    setSending(true);
    setError(null);
    try {
      await sendMagicLink(address, next);
      setSentTo(address);
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      setError(
        code === 'auth/network-request-failed'
          ? 'Could not send the link. Check your connection and try again.'
          : authErrorMessage(err),
      );
    }
    setSending(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return setError('Enter your email.');
    if (!EMAIL_SHAPE.test(address)) {
      return setError('That email address doesn’t look right. Check it and try again.');
    }
    void send(address);
  }

  const offlineNote = !online && (
    <p className="text-xs text-fg-muted">You are offline. Connect to send a link.</p>
  );

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 ref={sentHeadingRef} tabIndex={-1} className="text-lg font-semibold text-fg outline-none">
            Check your email
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            We sent a sign-in link to <strong className="font-medium break-all text-fg">{sentTo}</strong>. Open it
            on this device.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger-text">
            {error}
          </p>
        )}
        {offlineNote}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <button
            type="button"
            onClick={() => send(sentTo)}
            disabled={cooldown > 0 || sending || !online}
            className="cursor-pointer font-medium text-brand-text hover:underline disabled:cursor-not-allowed disabled:text-fg-faint disabled:no-underline"
          >
            {sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown} s` : 'Resend link'}
          </button>
          {/* Announce only when the link becomes usable, not every second. */}
          <span className="sr-only" aria-live="polite">
            {cooldown === 0 && !sending ? 'You can resend the link now.' : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              setSentTo(null);
              setError(null);
              setCooldown(0);
              setEmail('');
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="cursor-pointer font-medium text-fg-muted hover:text-fg hover:underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Input
        ref={inputRef}
        label="Email"
        type="email"
        name="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (error) setError(null);
        }}
        placeholder="you@example.com"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        // The page has one job; focusing its only field is expected (01-auth.md).
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'admin-sign-in-error' : undefined}
      />
      {error && (
        <p id="admin-sign-in-error" role="alert" className="-mt-2 text-xs text-danger-text">
          {error}
        </p>
      )}
      {offlineNote}
      <Button
        type="submit"
        variant="primary"
        size="md"
        fullWidth
        disabled={!online}
        loading={sending}
        loadingText="Sending…"
      >
        Send sign-in link
      </Button>
    </form>
  );
}
