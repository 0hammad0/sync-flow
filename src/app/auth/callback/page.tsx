'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { clientAuth } from '@/lib/firebase/client';
import LoadingSpinner from '@/components/LoadingSpinner';
import Button from '@/components/ui/Button';
import { AlertCircle } from 'lucide-react';

const STORED_EMAIL_KEY = 'syncflow.emailForSignIn';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'working' | 'needs_email' | 'error'>('working');
  const [error, setError] = useState<string | null>(null);
  const [emailPrompt, setEmailPrompt] = useState('');

  useEffect(() => {
    const auth = clientAuth();
    const url = window.location.href;

    if (!isSignInWithEmailLink(auth, url)) {
      setError('This link is not a valid sign-in link.');
      setStatus('error');
      return;
    }

    const storedEmail = window.localStorage.getItem(STORED_EMAIL_KEY);
    if (storedEmail) {
      void complete(storedEmail);
    } else {
      setStatus('needs_email');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function complete(email: string) {
    setStatus('working');
    setError(null);
    try {
      const result = await signInWithEmailLink(clientAuth(), email, window.location.href);
      window.localStorage.removeItem(STORED_EMAIL_KEY);

      const idToken = await result.user.getIdToken();
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to establish session');
      }

      router.replace('/dashboard');
    } catch (err) {
      console.error('Sign-in callback error:', err);
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setStatus('error');
    }
  }

  if (status === 'working') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 animate-fade-in">
        <LoadingSpinner size="lg" className="text-brand-text" />
        <p className="text-sm text-fg-muted">Signing you in&hellip;</p>
      </div>
    );
  }

  if (status === 'needs_email') {
    return (
      <div className="max-w-sm mx-auto py-12 animate-fade-in">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">Confirm your email</h1>
        <p className="text-sm text-fg-muted mb-4">
          For security, please confirm the email address you used to request the sign-in link.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (emailPrompt) void complete(emailPrompt);
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
            className="input-base w-full px-3 py-2.5 text-base sm:text-sm"
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
      <Button href="/login" variant="primary" size="lg">
        Back to sign-in
      </Button>
    </div>
  );
}
