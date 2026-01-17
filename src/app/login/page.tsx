'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getBaseUrl } from '@/lib/utils';
import LoadingSpinner from '@/components/LoadingSpinner';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const checkUser = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        router.replace('/dashboard');
      } else {
        setCheckingAuth(false);
      }
    };

    checkUser();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${getBaseUrl()}/auth/callback`,
      },
    });

    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({
        type: 'success',
        text: 'Check your email for the magic link!',
      });
    }

    setLoading(false);
  };

  if (checkingAuth) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto py-8 sm:py-12 px-4 sm:px-0 animate-fade-in">
      <div className="text-center mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Sign In</h1>
        <p className="text-sm sm:text-base text-gray-600">
          Enter your email to receive a magic link
        </p>
        <p className="text-xs text-gray-400 mt-1">
          No password needed — we&apos;ll email you a secure link
        </p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5">
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
            className="w-full px-3 sm:px-4 py-2.5 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-sm sm:text-base"
            aria-describedby="email-help"
          />
          <p id="email-help" className="mt-1.5 text-xs text-gray-400">
            We&apos;ll send a one-time login link to this address.
          </p>
        </div>

        <button
          type="submit"
          disabled={loading || !email}
          className={`w-full py-2.5 sm:py-3 px-4 rounded-lg text-white font-medium text-sm sm:text-base transition-all duration-200 flex items-center justify-center gap-2 ${
            loading || !email
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 cursor-pointer btn-hover'
          }`}
        >
          {loading ? (
            <>
              <LoadingSpinner size="sm" className="text-white" />
              <span>Sending...</span>
            </>
          ) : (
            'Send Magic Link'
          )}
        </button>
      </form>

      {message && (
        <div
          className={`mt-4 p-3 sm:p-4 rounded-lg animate-fade-in text-xs sm:text-sm ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          <p className="font-medium">{message.text}</p>
          {message.type === 'success' && (
            <p className="mt-1 text-green-600">
              Click the link in your email to sign in. Check your spam folder if you don&apos;t see it.
            </p>
          )}
          {message.type === 'error' && (
            <p className="mt-1 text-red-500">
              Please check your email address and try again.
            </p>
          )}
        </div>
      )}

      <div className="mt-8 pt-6 border-t border-gray-200">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
          Why sign in?
        </h3>
        <ul className="space-y-2 text-xs sm:text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-0.5">✓</span>
            <span>View and manage all your uploaded files</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-0.5">✓</span>
            <span>Delete files you no longer need</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-0.5">✓</span>
            <span>Access your files from any device</span>
          </li>
        </ul>
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        Don&apos;t want to sign in?{' '}
        <Link href="/" className="text-blue-600 hover:underline">
          Upload anonymously
        </Link>
      </p>
    </div>
  );
}
