'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { clientAuth } from '@/shared/lib/firebase/client';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import Logo from '@/shared/components/Logo';
import ThemeToggle from '@/shared/components/ThemeToggle';
import { FolderOpen, LogOut, MessageSquare, Smartphone } from 'lucide-react';

/** Pill nav links shown to everyone (signed in or not). */
function FeatureLinks() {
  return (
    <>
      <Link
        href="/chat"
        className="text-xs sm:text-sm text-fg-muted hover:text-brand-text transition-all duration-200 px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl hover:bg-brand/10 flex items-center gap-1.5 font-medium"
        title="Temporary chat rooms"
      >
        <MessageSquare className="w-4 h-4" />
        <span className="max-[480px]:hidden">Chat</span>
      </Link>
      <Link
        href="/receive"
        className="text-xs sm:text-sm text-fg-muted hover:text-brand-text transition-all duration-200 px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl hover:bg-brand/10 flex items-center gap-1.5 font-medium"
        title="Receive files from your phone"
      >
        <Smartphone className="w-4 h-4" />
        <span className="max-[480px]:hidden">Receive</span>
      </Link>
    </>
  );
}

export default function Header() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(clientAuth(), (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Floating-island header: flat at the top of the page, detaches into a
  // centered glass pill once the user scrolls.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut(clientAuth());
      await fetch('/api/session', { method: 'DELETE' });
      window.location.href = '/';
    } catch (error) {
      console.error('Sign out error:', error);
      setSigningOut(false);
    }
  };

  return (
    <header
      className={`sticky top-0 z-50 transition-[padding] duration-300 ${
        scrolled ? 'pt-2 sm:pt-3 px-2 sm:px-4' : 'pt-0 px-0'
      }`}
    >
      <div
        className={`mx-auto flex items-center justify-between gap-2 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          scrolled
            ? 'max-w-3xl glass rounded-full px-3 sm:px-5 py-2 shadow-[var(--shadow-card-hover)]'
            : 'max-w-4xl bg-transparent border-b border-edge px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3.5'
        }`}
      >
        <Link
          href="/"
          className="flex items-center gap-2 transition-opacity duration-200 hover:opacity-80 shrink-0"
        >
          <Logo className="w-7 h-7 sm:w-8 sm:h-8" />
          <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-fg max-[360px]:hidden">
            Sync<span className="text-flow">Flow</span>
          </span>
        </Link>

        <nav className="flex items-center gap-0.5 sm:gap-1.5">
          <FeatureLinks />

          {loading ? (
            <div className="flex items-center px-3 py-2">
              <LoadingSpinner size="sm" className="text-fg-faint" />
            </div>
          ) : user ? (
            <>
              <Link
                href="/dashboard"
                className="text-xs sm:text-sm text-fg-muted hover:text-fg transition-colors duration-200 px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl hover:bg-surface-2 flex items-center gap-1.5 font-medium"
                title="Your uploaded files"
              >
                <FolderOpen className="w-4 h-4" />
                <span className="max-[560px]:hidden">My Files</span>
              </Link>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="text-xs sm:text-sm text-fg-muted hover:text-fg transition-colors duration-200 cursor-pointer px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl hover:bg-surface-2 disabled:opacity-50 flex items-center gap-1.5 font-medium"
                title="Sign out"
              >
                {signingOut ? (
                  <LoadingSpinner size="sm" className="text-fg-faint" />
                ) : (
                  <>
                    <LogOut className="w-4 h-4" />
                    <span className="max-[560px]:hidden">Sign Out</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="text-xs sm:text-sm bg-flow text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl font-medium cursor-pointer btn-hover hover:shadow-[var(--glow)] hover:brightness-110 transition-all duration-200 whitespace-nowrap"
            >
              Sign In
            </Link>
          )}

          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
