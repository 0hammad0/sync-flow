import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, FileUp, MessagesSquare, Smartphone } from 'lucide-react';
import { ISSUES_URL } from '@/shared/lib/site';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

const TOOLS = [
  { href: '/', label: 'Share files', icon: FileUp },
  { href: '/receive', label: 'Phone → PC', icon: Smartphone },
  { href: '/chat', label: 'Chat rooms', icon: MessagesSquare },
];

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-12 sm:py-20 animate-fade-in">
      <p className="font-mono text-sm text-fg-faint">404</p>
      <h1 className="mt-3 font-display text-4xl sm:text-5xl font-bold tracking-[-0.03em] text-fg text-balance">
        This page doesn&apos;t exist, or it already expired.
      </h1>
      <p className="mt-4 text-base leading-relaxed text-fg-muted">
        Share links, Phone → PC sessions and chat rooms are temporary by design. If someone sent
        you this link, ask them for a fresh one.
      </p>

      <ul className="mt-8 divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface">
        {TOOLS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="group flex items-center gap-3 px-4 py-3.5 text-fg transition-colors duration-200 hover:bg-surface-2/70"
            >
              <Icon className="h-4 w-4 text-brand-text" aria-hidden="true" />
              <span className="flex-1 font-medium">{label}</span>
              <ArrowRight
                className="h-4 w-4 text-fg-faint transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm text-fg-muted">
        Think this is a bug?{' '}
        <a
          href={ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-text underline underline-offset-4 decoration-brand-text/40 hover:decoration-brand-text"
        >
          Report it on GitHub
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>
    </div>
  );
}
