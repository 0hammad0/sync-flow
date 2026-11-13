'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { breadcrumbsFor } from './nav';

/** `Sessions / 7f3a…`. Under 640 px only the last crumb (the page) shows. */
export default function Breadcrumbs() {
  const crumbs = breadcrumbsFor(usePathname() ?? '/admin');
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          if (last) {
            return (
              <li key={crumb.href} className="min-w-0">
                <span aria-current="page" className="block truncate font-medium text-fg">
                  {crumb.label}
                </span>
              </li>
            );
          }
          return (
            <li key={crumb.href} className="hidden shrink-0 items-center gap-1.5 sm:flex">
              <Link href={crumb.href} className="rounded-sm text-fg-muted pointer-fine:hover:text-fg">
                {crumb.label}
              </Link>
              <span aria-hidden="true" className="text-fg-faint">
                /
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
