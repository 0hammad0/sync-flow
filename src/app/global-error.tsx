'use client';

import { useEffect } from 'react';
import './globals.css';

/**
 * Last-resort boundary: replaces the root layout when it fails, so it must
 * render its own <html>/<body> and can't rely on the header or fonts.
 */
export default function GlobalError({
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
    <html lang="en" className="dark">
      <body className="min-h-screen bg-canvas text-fg antialiased">
        <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
          <div role="alert">
            <p className="font-mono text-sm text-fg-faint">SyncFlow</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-balance">
              SyncFlow couldn&apos;t load.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-fg-muted">
              Something failed before the page could start. Reload to try again.
            </p>
            {error.digest && (
              <p className="mt-3 font-mono text-xs text-fg-faint">Error reference: {error.digest}</p>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-11 items-center rounded-xl bg-flow px-5 text-sm font-semibold text-white cursor-pointer"
              >
                Try again
              </button>
              {/* A full reload on purpose: client navigation may be what broke. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="inline-flex h-11 items-center rounded-xl border border-edge-strong px-5 text-sm font-semibold text-fg"
              >
                Home page
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
