'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import {
  authErrorMessage,
  clientAuth,
  isDeadLinkError,
  safeNextPath,
  sendMagicLink,
  STORED_EMAIL_KEY,
  STORED_NEXT_KEY,
} from '@/shared/lib/firebase/client';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import Button from '@/shared/ui/Button';
import { AlertCircle, MailCheck } from 'lucide-react';

/** Where to go after sign-in: ?next= on the link, else the copy saved when the link was sent. */
function readNext(): string | null {
  return (
    safeNextPath(new URLSearchParams(window.location.search).get('next')) ??
    safeNextPath(window.localStorage.getItem(STORED_NEXT_KEY))
  );
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'working' | 'needs_email' | 'error' | 'resent'>('working');
  const [error, setError] = useState<string | null>(null);
  // The link itself is unusable (expired, used, malformed) — offer a new one.
  const [deadLink, setDeadLink] = useState(false);
  const [emailPrompt, setEmailPrompt] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    // Async so state is only set after the effect returns (no cascading render).
    const start = async () => {
      const auth = clientAuth();
      const url = window.location.href;

      if (!isSignInWithEmailLink(auth, url)) {
        setError('This link is not a valid sign-in link.');
        setDeadLink(true);
        setStatus('error');
        return;
      }

      const storedEmail = window.localStorage.getItem(STORED_EMAIL_KEY);
      if (storedEmail) {
        await complete(storedEmail);
      } else {
        setStatus('needs_email');
      }
    };
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function complete(email: string) {
    setStatus('working');
    setError(null);
    let signedIn = false;
    try {
      const result = await signInWithEmailLink(clientAuth(), email, window.location.href);
      signedIn = true;
      const next = readNext();
      window.localStorage.removeItem(STORED_EMAIL_KEY);
      window.localStorage.removeItem(STORED_NEXT_KEY);

      const idToken = await result.user.getIdToken();
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error('session');

      router.replace(next ?? '/dashboard');
    } catch (err) {
      console.error('Sign-in callback error:', err);
      setDeadLink(isDeadLinkError(err));
      setError(
        signedIn
          ? 'You’re signed in, but we couldn’t start your session. Please try signing in again.'
          : authErrorMessage(err)
      );
      setStatus('error');
    }
  }

  // Email a fresh link straight away when we still know the address;
  // otherwise send the user to /login to type it.
  async function sendNewLink() {
    const email = window.localStorage.getItem(STORED_EMAIL_KEY);
    const next = readNext();
    if (!email) {
      router.push(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
      return;
    }
    setResending(true);
    try {
      await sendMagicLink(email, next);
      setEmailPrompt(email);
      setStatus('resent');
    } catch (err) {
      setError(authErrorMessage(err));
    }
    setResending(false);
  }

  if (status === 'working') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 animate-fade-in">
        <LoadingSpinner size="lg" className="text-brand-text" />
        <p className="text-sm text-fg-muted">Signing you in&hellip;</p>
      </div>
    );
  }

  if (status === 'resent') {
    return (
      <div className="max-w-sm mx-auto py-12 text-center animate-fade-in">
        <span className="inline-flex w-16 h-16 mb-4 rounded-3xl bg-success/10 text-success-text items-center justify-center">
          <MailCheck className="w-8 h-8" />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">New link sent</h1>
        <p className="text-sm text-fg-muted">
          Check <span className="font-medium text-fg break-all">{emailPrompt}</span> for a fresh sign-in link.
        </p>
        <p className="mt-3 text-xs text-fg-faint">The device that opens the link is the one that gets signed in.</p>
      </div>
    );
  }

  if (status === 'needs_email') {
    return (
      <div className="max-w-sm mx-auto py-12 animate-fade-in">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">Confirm your email</h1>
        <p className="text-sm text-fg-muted mb-4">
          This link was opened on a different device or browser than the one that asked for it. Confirm the email
          address to sign in here.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const email = emailPrompt.trim();
            if (email) void complete(email);
          }}
          className="space-y-3"
        >
          <input
            type="email"
            value={emailPrompt}
            onChange={(e) => setEmailPrompt(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            aria-label="Email address"
            className="input-base w-full px-3 py-2.5 text-base pointer-fine:sm:text-sm"
          />
          <Button type="submit" variant="primary" size="md" fullWidth>
            Continue
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto py-12 text-center animate-fade-in">
      <span className="inline-flex w-16 h-16 mb-4 rounded-3xl bg-danger/10 text-danger-text items-center justify-center">
        <AlertCircle className="w-8 h-8" />
      </span>
      <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">Sign-in failed</h1>
      <p className="text-sm text-fg-muted mb-6">{error}</p>
      {deadLink ? (
        <Button variant="primary" size="lg" onClick={sendNewLink} loading={resending} loadingText="Sending...">
          Send a new link
        </Button>
      ) : (
        <Button href="/login" variant="primary" size="lg">
          Back to sign-in
        </Button>
      )}
    </div>
  );
}
