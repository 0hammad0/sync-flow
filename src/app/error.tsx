'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { ISSUES_URL } from '@/shared/lib/site';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-xl py-12 sm:py-20 animate-fade-in">
      <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-[-0.03em] text-fg text-balance">
        Something went wrong on this page.
      </h1>
      <p className="mt-4 text-base leading-relaxed text-fg-muted">
        Nothing you did caused this. Try again; if it keeps happening, go back to the start or let
        us know.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-xs text-fg-faint">Error reference: {error.digest}</p>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-flow px-5 text-sm font-semibold text-white shadow-md transition-[filter] duration-200 hover:brightness-110 cursor-pointer"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-xl border border-edge-strong px-5 text-sm font-semibold text-fg transition-colors duration-200 hover:bg-surface-2"
        >
          Go to the home page
        </Link>
      </div>
      <p className="mt-6 text-sm text-fg-muted">
        Still broken?{' '}
        <a
          href={ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-text underline underline-offset-4 decoration-brand-text/40 hover:decoration-brand-text"
        >
          Open an issue on GitHub
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {error.digest ? ' and include the reference above.' : '.'}
      </p>
    </div>
  );
}
