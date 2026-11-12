import Link from 'next/link';
import { ArrowUpRight, Github } from 'lucide-react';
import Logo from '@/shared/components/Logo';
import { ISSUES_URL, LICENSE_URL, REPO_URL } from '@/shared/lib/site';

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Share files', href: '/' },
      { label: 'Phone → PC', href: '/receive' },
      { label: 'Chat rooms', href: '/chat' },
      { label: 'My Files', href: '/dashboard' },
    ],
  },
  {
    title: 'Open source',
    links: [
      { label: 'Source code', href: REPO_URL, external: true },
      { label: 'MIT licence', href: LICENSE_URL, external: true },
      { label: 'Report an issue', href: ISSUES_URL, external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Contact (GitHub Issues)', href: ISSUES_URL, external: true },
    ],
  },
];

const linkClass =
  'inline-flex items-center gap-1 text-sm text-fg-muted transition-colors duration-200 hover:text-fg rounded';

export default function SiteFooter() {
  return (
    <footer id="site-footer" className="mt-16 sm:mt-24 border-t border-edge bg-surface/50">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-12 sm:py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <Link href="/" className="inline-flex items-center gap-2 rounded-lg" aria-label="SyncFlow home">
              <Logo size={28} className="w-7 h-7" decorative />
              <span className="font-display text-lg font-bold tracking-tight text-fg">SyncFlow</span>
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">
              Private file sharing, phone-to-PC transfers and temporary chat rooms that work in
              any browser. Free and open source.
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-edge-strong text-sm font-medium text-fg transition-colors duration-200 hover:bg-surface-2"
            >
              <Github className="w-4 h-4" aria-hidden="true" />
              Star on GitHub
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="text-sm font-semibold text-fg">{col.title}</h2>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
                        {l.label}
                        <ArrowUpRight className="w-3.5 h-3.5 text-fg-faint" aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link href={l.href} className={linkClass}>
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-edge pt-6 text-xs text-fg-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} SyncFlow contributors. Released under the MIT licence.</p>
          <p>No ads, no trackers, no paid tiers.</p>
        </div>
      </div>
    </footer>
  );
}
