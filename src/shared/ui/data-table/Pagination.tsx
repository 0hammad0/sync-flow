'use client';

import type { MouseEvent, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buttonClass } from '@/shared/ui/button-styles';
import { formatCount } from './styles';

const PAGE_LINK = buttonClass({ variant: 'ghost', size: 'sm' });

export type PaginationProps = {
  /** `cursor`: Newer / Older (Firestore). `load-more`: one "Load more" link (Auth page tokens, no total). */
  mode?: 'cursor' | 'load-more';
  /** Cursor of the newer page. `null` on the first page. `FIRST_PAGE_CURSOR` ('') when the newer page is the first. */
  prevCursor: string | null;
  /** Cursor of the older page. `null` on the last page. */
  nextCursor: string | null;
  /** Rows on this page. */
  shown: number;
  /** All matches (`count()` aggregation). Omit when unknown. */
  total?: number | null;
  /** Full href for a cursor (keeps every other param), so the links work without JS and in a new tab. */
  hrefFor: (cursor: string | null) => string;
  /** In-app navigation (URL state in a transition). Modified clicks fall through to the browser. */
  onNavigate: (cursor: string | null) => void;
  className?: string;
};

/**
 * Cursor paging, 25 rows, no page numbers: Firestore has no cheap offsets
 * (08-tables.md "Pagination"). Two real links in a labelled nav.
 */
export default function Pagination({
  mode = 'cursor',
  prevCursor,
  nextCursor,
  shown,
  total,
  hrefFor,
  onNavigate,
  className = '',
}: PaginationProps) {
  const summary = total == null ? `Showing ${formatCount(shown)}` : `Showing ${formatCount(shown)} of ${formatCount(total)}`;

  return (
    <nav aria-label="Pagination" className={`flex min-h-12 items-center justify-between gap-3 px-3 ${className}`}>
      <p className="text-[13px] text-fg-muted tabular-nums">{summary}</p>
      <div className="flex items-center gap-1">
        {mode === 'cursor' && (
          <PageLink cursor={prevCursor} hrefFor={hrefFor} onNavigate={onNavigate}>
            <ChevronLeft aria-hidden="true" strokeWidth={1.75} className="size-4" />
            Newer
          </PageLink>
        )}
        <PageLink cursor={nextCursor} hrefFor={hrefFor} onNavigate={onNavigate}>
          {mode === 'cursor' ? (
            <>
              Older
              <ChevronRight aria-hidden="true" strokeWidth={1.75} className="size-4" />
            </>
          ) : (
            'Load more'
          )}
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  cursor,
  hrefFor,
  onNavigate,
  children,
}: {
  cursor: string | null;
  hrefFor: PaginationProps['hrefFor'];
  onNavigate: PaginationProps['onNavigate'];
  children: ReactNode;
}) {
  if (cursor === null) {
    // No href: not focusable, announced as a disabled link.
    return (
      <a aria-disabled="true" role="link" className={PAGE_LINK}>
        {children}
      </a>
    );
  }
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate(cursor);
  };
  return (
    <a href={hrefFor(cursor)} onClick={onClick} className={PAGE_LINK}>
      {children}
    </a>
  );
}
