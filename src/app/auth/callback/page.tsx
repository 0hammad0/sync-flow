'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { clientAuth } from '@/lib/firebase/client';
import LoadingSpinner from '@/components/LoadingSpinner';
import Link from 'next/link';

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
        <LoadingSpinner size="lg" />
        <p className="text-sm text-gray-500">Signing you in&hellip;</p>
      </div>
    );
  }

  if (status === 'needs_email') {
    return (
      <div className="max-w-sm mx-auto py-12 px-4 animate-fade-in">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Confirm your email</h1>
        <p className="text-sm text-gray-600 mb-4">
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
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 cursor-pointer"
          >
            Continue
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto py-12 px-4 text-center animate-fade-in">
      <div className="text-5xl mb-4">❌</div>
      <h1 className="text-xl font-bold text-gray-900 mb-2">Sign-in failed</h1>
      <p className="text-sm text-gray-600 mb-6">{error}</p>
      <Link
        href="/login"
        className="inline-block px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
      >
        Back to sign-in
      </Link>
    </div>
  );
}
