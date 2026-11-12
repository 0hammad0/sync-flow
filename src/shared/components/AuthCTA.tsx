'use client';

import Link from 'next/link';
import { ArrowRight, FolderOpen, UserRound } from 'lucide-react';
import { useSignedIn } from '@/shared/lib/auth-state';

/**
 * Account nudge. Both variants are server-rendered and CSS shows the right
 * one before first paint (see `.when-signed-in` in globals.css), so it never
 * pops in or shifts the layout once Firebase answers.
 */
export default function AuthCTA({ className = '' }: { className?: string }) {
  useSignedIn(); // keeps <html data-auth> in sync

  return (
    <div className={className}>
      <p className="when-signed-in flex items-start gap-2.5 text-sm text-fg-muted">
        <FolderOpen className="w-4 h-4 shrink-0 mt-0.5 text-brand-text" aria-hidden="true" />
        <span>
          You&apos;re signed in.{' '}
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 font-medium text-brand-text underline underline-offset-4 decoration-brand-text/40 hover:decoration-brand-text"
          >
            Open My Files
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </span>
      </p>
      <p className="when-signed-out flex items-start gap-2.5 text-sm text-fg-muted">
        <UserRound className="w-4 h-4 shrink-0 mt-0.5 text-brand-text" aria-hidden="true" />
        <span>
          <Link
            href="/login"
            className="font-medium text-brand-text underline underline-offset-4 decoration-brand-text/40 hover:decoration-brand-text"
          >
            Sign in with an email link
          </Link>{' '}
          to keep up to 10 files in My Files and choose 30-day or no expiry.
        </span>
      </p>
    </div>
  );
}
