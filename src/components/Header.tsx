'use client';

import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import LoadingSpinner from './LoadingSpinner';
import { Smartphone } from 'lucide-react';

export default function Header() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      // Use hard redirect to ensure cookies are cleared and page fully refreshes
      window.location.href = '/';
    } catch (error) {
      console.error('Sign out error:', error);
      setSigningOut(false);
    }
  };

  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 transition-opacity duration-200 hover:opacity-80"
        >
          <Image
            src="/logo.png"
            alt="SyncFlow"
            width={32}
            height={32}
            className="w-7 h-7 sm:w-8 sm:h-8"
          />
          <span className="text-lg sm:text-xl font-semibold text-gray-900">
            SyncFlow
          </span>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-4">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <LoadingSpinner size="sm" className="text-gray-400" />
            </div>
          ) : user ? (
            <>
              <Link
                href="/receive"
                className="text-xs sm:text-sm text-indigo-600 hover:text-indigo-700 transition-all duration-200 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 flex items-center gap-1.5 font-medium"
                title="Receive files from your phone"
              >
                <Smartphone className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>Receive</span>
              </Link>
              <Link
                href="/dashboard"
                className="text-xs sm:text-sm text-gray-600 hover:text-gray-900 transition-colors duration-200 px-2 sm:px-3 py-1.5 sm:py-2 rounded-md hover:bg-gray-100"
              >
                My Files
              </Link>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="text-xs sm:text-sm text-gray-600 hover:text-gray-900 transition-colors duration-200 cursor-pointer px-2 sm:px-3 py-1.5 sm:py-2 rounded-md hover:bg-gray-100 disabled:opacity-50 flex items-center gap-1.5"
              >
                {signingOut ? (
                  <>
                    <LoadingSpinner size="sm" className="text-gray-500" />
                    <span className="hidden sm:inline">Signing out...</span>
                  </>
                ) : (
                  'Sign Out'
                )}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/receive"
                className="text-xs sm:text-sm text-indigo-600 hover:text-indigo-700 transition-all duration-200 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 flex items-center gap-1.5 font-medium"
                title="Receive files from your phone"
              >
                <Smartphone className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>Receive</span>
              </Link>
              <Link
                href="/login"
                className="text-xs sm:text-sm bg-gray-900 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg hover:bg-gray-800 cursor-pointer btn-hover transition-colors duration-200"
              >
                Sign In
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
