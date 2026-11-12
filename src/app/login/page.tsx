'use client';

import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  authErrorMessage,
  clientAuth,
  safeNextPath,
  sendMagicLink,
  STORED_EMAIL_KEY,
} from '@/shared/lib/firebase/client';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import Button from '@/shared/components/ui/Button';
import Link from 'next/link';
import { Check, MailCheck } from 'lucide-react';

const RESEND_COOLDOWN_S = 30;

function readNext(): string | null {
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}

/*
 * The client remembers a Firebase user indefinitely, but the server cookie
 * lasts 14 days. The proxy sends visitors with a valid cookie straight on, so
 * reaching /login while the client is signed in means the cookie is gone. A
 * new cookie needs a sign-in from the last 5 minutes (Firebase rule), so sign
 * the client out instead of bouncing to /dashboard (which would loop).
 */

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Address the link was sent to; switches the page to "check your email".
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let handled = false;
    const unsub = onAuthStateChanged(clientAuth(), async (user) => {
      if (handled) return;
      handled = true;
      if (user) {
        await signOut(clientAuth()).catch(() => {});
        setNotice('Your session ended. Sign in again to continue.');
      }
      const stored = window.localStorage.getItem(STORED_EMAIL_KEY);
      if (stored) setEmail(stored);
      setCheckingAuth(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = async (address: string) => {
    setLoading(true);
    setError(null);
    try {
      await sendMagicLink(address, readNext());
      setSentTo(address);
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      console.error('Send sign-in link error:', err);
      setError(authErrorMessage(err));
    }
    setLoading(false);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (address) void send(address);
  };

  if (checkingAuth) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" className="text-brand-text" />
      </div>
    );
  }

  if (sentTo) {
    return (
      <div className="max-w-sm mx-auto py-8 sm:py-12 text-center animate-fade-in">
        <span className="inline-flex w-16 h-16 mb-4 rounded-3xl bg-success/10 text-success-text items-center justify-center">
          <MailCheck className="w-8 h-8" />
        </span>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2">Check your email</h1>
        <p className="text-sm text-fg-muted">
          We sent a sign-in link to <span className="font-medium text-fg break-all">{sentTo}</span>
        </p>
        <p className="mt-3 text-xs text-fg-faint">
          The device that opens the link is the one that gets signed in — open it here to sign in on this device.
          Check your spam folder if you don&apos;t see it.
        </p>

        {error && (
          <p role="alert" className="mt-4 p-3 rounded-2xl text-xs bg-danger/10 border border-danger/20 text-danger-text">
            {error}
          </p>
        )}

        <div className="mt-6 space-y-2">
          <Button
            variant="secondary"
            size="md"
            fullWidth
            onClick={() => send(sentTo)}
            disabled={cooldown > 0}
            loading={loading}
            loadingText="Sending..."
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
          </Button>
          <Button
            variant="ghost"
            size="md"
            fullWidth
            onClick={() => {
              setSentTo(null);
              setError(null);
              setEmail('');
            }}
          >
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto py-8 sm:py-12 animate-fade-in">
      <div className="text-center mb-6 sm:mb-8">
        <p className="label-mono mb-3">Passwordless</p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2">Sign In</h1>
        <p className="text-sm sm:text-base text-fg-muted">
          Enter your email to receive a sign-in link
        </p>
        <p className="text-xs text-fg-faint mt-1">
          No password needed — we&apos;ll email you a secure link
        </p>
      </div>

      {notice && (
        <p className="mb-4 p-3 rounded-2xl text-xs sm:text-sm bg-surface-2 border border-edge text-fg-muted">{notice}</p>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs sm:text-sm font-medium text-fg mb-1.5">
            Email address
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="input-base w-full px-3 sm:px-4 py-2.5 sm:py-3 text-base sm:text-sm"
            aria-describedby="email-help"
          />
          <p id="email-help" className="mt-1.5 text-xs text-fg-faint">
            We&apos;ll send a one-time login link to this address.
          </p>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={loading || !email.trim()}
          loading={loading}
          loadingText="Sending..."
        >
          Send Sign-In Link
        </Button>

        <p className="text-[11px] text-fg-faint text-center">
          By signing in you agree to our{' '}
          <Link href="/terms" className="text-fg-muted hover:text-fg underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-fg-muted hover:text-fg underline">
            Privacy Policy
          </Link>
          .
        </p>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-4 p-3 sm:p-4 rounded-2xl animate-fade-in text-xs sm:text-sm border bg-danger/10 border-danger/20 text-danger-text font-medium"
        >
          {error}
        </p>
      )}

      <div className="mt-8 pt-6 border-t border-edge">
        <p className="label-mono mb-3">Why sign in?</p>
        <ul className="space-y-2 text-xs sm:text-sm text-fg-muted">
          <li className="flex items-start gap-2">
            <Check className="w-4 h-4 shrink-0 text-success-text mt-0.5" />
            <span>View and manage all your uploaded files</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-4 h-4 shrink-0 text-success-text mt-0.5" />
            <span>Delete files you no longer need</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-4 h-4 shrink-0 text-success-text mt-0.5" />
            <span>Access your files from any device</span>
          </li>
        </ul>
      </div>

      <p className="mt-6 text-center text-xs text-fg-faint">
        Don&apos;t want to sign in?{' '}
        <Link href="/" className="text-brand-text hover:underline font-medium">
          Upload anonymously
        </Link>
      </p>
    </div>
  );
}
