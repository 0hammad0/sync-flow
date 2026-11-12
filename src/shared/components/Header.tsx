'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { clientAuth } from '@/shared/lib/firebase/client';
import { clearAuthHint, useSignedIn } from '@/shared/lib/auth-state';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import Logo from '@/shared/components/Logo';
import ThemeToggle from '@/shared/components/ThemeToggle';
import {
  FileUp,
  FolderOpen,
  LogIn,
  LogOut,
  MessagesSquare,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: (path: string) => boolean;
}

/** The three tools — same names as the landing page and footer. */
const TOOLS: NavItem[] = [
  { href: '/', label: 'Share files', icon: FileUp, isActive: (p) => p === '/' },
  {
    href: '/receive',
    label: 'Phone → PC',
    icon: Smartphone,
    isActive: (p) => p === '/receive' || p.startsWith('/receive/'),
  },
  {
    href: '/chat',
    label: 'Chat rooms',
    icon: MessagesSquare,
    isActive: (p) => p === '/chat' || p.startsWith('/chat/'),
  },
];

const navLink =
  'relative inline-flex items-center gap-2 h-9 px-2.5 sm:px-3 rounded-lg text-sm font-medium transition-colors duration-200';

export default function Header() {
  const pathname = usePathname() ?? '/';
  const [signingOut, setSigningOut] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Keeps <html data-auth> in sync with Firebase; the signed-in/out variants
  // below are both rendered and CSS picks one before first paint.
  useSignedIn();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The phone upload page (/send/…) is a focused, single-task screen.
  if (pathname.startsWith('/send/')) return null;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut(clientAuth());
      await fetch('/api/session', { method: 'DELETE' });
      clearAuthHint();
      // Full reload on purpose: it drops every piece of signed-in client state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/';
    } catch (error) {
      console.error('Sign out error:', error);
      setSigningOut(false);
    }
  };

  const onDashboard = pathname === '/dashboard' || pathname.startsWith('/dashboard/');

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-300 ${
        scrolled
          ? 'border-edge bg-[var(--overlay)] backdrop-blur-xl backdrop-saturate-150 shadow-[0_1px_0_var(--edge),0_12px_32px_-24px_rgba(0,0,0,0.35)]'
          : 'border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-14 sm:h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 rounded-lg transition-opacity duration-200 hover:opacity-80"
          aria-label="SyncFlow home"
        >
          <Logo className="w-7 h-7 sm:w-8 sm:h-8" decorative />
          <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-fg max-[400px]:hidden">
            SyncFlow
          </span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <nav aria-label="Tools">
            <ul className="flex items-center gap-0.5 sm:gap-1">
              {TOOLS.map(({ href, label, icon: Icon, isActive }) => {
                const active = isActive(pathname);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      title={label}
                      className={`${navLink} ${
                        active
                          ? 'text-fg bg-surface-2'
                          : 'text-fg-muted hover:text-fg hover:bg-surface-2/70'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${active ? 'text-brand-text' : ''}`} aria-hidden="true" />
                      <span className="max-md:sr-only">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <span className="hidden sm:block h-5 w-px bg-edge-strong" aria-hidden="true" />

          {/* Account — both variants rendered, CSS shows the right one */}
          <div className="when-signed-in flex items-center gap-0.5 sm:gap-1">
            <Link
              href="/dashboard"
              aria-current={onDashboard ? 'page' : undefined}
              title="My Files"
              className={`${navLink} ${
                onDashboard ? 'text-fg bg-surface-2' : 'text-fg-muted hover:text-fg hover:bg-surface-2/70'
              }`}
            >
              <FolderOpen className="w-4 h-4" aria-hidden="true" />
              <span className="max-lg:sr-only">My Files</span>
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              title="Sign out"
              className={`${navLink} text-fg-muted hover:text-fg hover:bg-surface-2/70 cursor-pointer disabled:opacity-60 disabled:cursor-wait`}
            >
              {signingOut ? (
                <LoadingSpinner size="sm" className="text-fg-faint" />
              ) : (
                <LogOut className="w-4 h-4" aria-hidden="true" />
              )}
              <span className="max-lg:sr-only">{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>

          <Link
            href="/login"
            className="when-signed-out inline-flex items-center gap-1.5 h-9 px-3 sm:px-3.5 rounded-lg text-sm font-semibold bg-fg text-canvas transition-opacity duration-200 hover:opacity-90 whitespace-nowrap"
          >
            <LogIn className="w-4 h-4 max-sm:hidden" aria-hidden="true" />
            Sign in
          </Link>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
