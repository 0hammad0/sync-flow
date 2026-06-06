'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, sendSignInLinkToEmail } from 'firebase/auth';
import { clientAuth } from '@/lib/firebase/client';
import { getBaseUrl } from '@/lib/utils';
import LoadingSpinner from '@/components/LoadingSpinner';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import { Check } from 'lucide-react';

const STORED_EMAIL_KEY = 'syncflow.emailForSignIn';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(clientAuth(), (user) => {
      if (user) {
        router.replace('/dashboard');
      } else {
        setCheckingAuth(false);
      }
    });
    return () => unsub();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      await sendSignInLinkToEmail(clientAuth(), email, {
        url: `${getBaseUrl()}/auth/callback`,
        handleCodeInApp: true,
      });
      window.localStorage.setItem(STORED_EMAIL_KEY, email);
      setMessage({
        type: 'success',
        text: 'Check your email for the sign-in link!',
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to send sign-in link';
      setMessage({ type: 'error', text });
    }

    setLoading(false);
  };

  if (checkingAuth) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" className="text-brand-text" />
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
          disabled={loading || !email}
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

      {message && (
        <div
          className={`mt-4 p-3 sm:p-4 rounded-2xl animate-fade-in text-xs sm:text-sm border ${
            message.type === 'success'
              ? 'bg-success/10 border-success/20 text-success-text'
              : 'bg-danger/10 border-danger/20 text-danger-text'
          }`}
        >
          <p className="font-medium">{message.text}</p>
          {message.type === 'success' && (
            <p className="mt-1 text-fg-muted">
              Click the link in your email to sign in. Check your spam folder if you don&apos;t see it.
            </p>
          )}
          {message.type === 'error' && (
            <p className="mt-1 text-fg-muted">
              Please check your email address and try again.
            </p>
          )}
        </div>
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
