'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive } from './nav';

/** The only client part of a nav row: marks the current page. */
export default function NavLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const active = isNavItemActive(href, usePathname() ?? '');
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={className}>
      {children}
    </Link>
  );
}
