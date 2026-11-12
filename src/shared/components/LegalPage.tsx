import Link from 'next/link';

/** Shared shell for /privacy and /terms: title, date, contents list, sections. */

export function LegalPage({
  title,
  updated,
  intro,
  sections,
  children,
}: {
  title: string;
  updated: string;
  intro?: React.ReactNode;
  sections: { id: string; title: string }[];
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl py-8 sm:py-12 animate-fade-in">
      <header className="border-b border-edge pb-8">
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-[-0.03em] text-fg">{title}</h1>
        <p className="mt-3 text-sm text-fg-muted">
          Last updated <time className="font-medium text-fg">{updated}</time>
        </p>
        {intro && <div className="mt-5 max-w-prose text-base leading-relaxed text-fg-muted">{intro}</div>}
      </header>

      <nav aria-label="On this page" className="border-b border-edge py-6">
        <h2 className="text-sm font-semibold text-fg">On this page</h2>
        <ol className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-fg-muted underline-offset-4 hover:text-fg hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div>{children}</div>
    </article>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-b border-edge py-8 last:border-b-0">
      <h2 id={`${id}-h`} className="font-display text-xl sm:text-2xl font-bold tracking-tight text-fg">
        {title}
      </h2>
      <div className="mt-4 max-w-prose space-y-4 text-[15px] leading-relaxed text-fg-muted [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

const linkClass =
  'font-medium text-brand-text underline underline-offset-4 decoration-brand-text/40 hover:decoration-brand-text';

export function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (href.startsWith('http')) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  );
}
