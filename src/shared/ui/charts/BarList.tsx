import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, ChartNoAxesColumn } from 'lucide-react';
import EmptyState from '../EmptyState';
import { formatShare, formatValue, type ValueFormat } from './format';

export type BarListItem = {
  label: string;
  value: number;
  /** Makes the row a link (filters the detail page). */
  href?: string;
  /** 16 px leading icon or flag. Decorative: the label names the row. */
  icon?: ReactNode;
};

export type BarListProps = {
  /** Sorted by the caller, largest first. */
  items: BarListItem[];
  format?: ValueFormat;
  /** Rows shown. Default 10. */
  max?: number;
  /** Adds the share column (`23.4%`) from 384 px of panel width. */
  showShare?: boolean;
  /** Share base. Default: the sum of all `items`, including rows past `max`. */
  total?: number;
  /** Footer link "View all" to the full table. */
  viewAllHref?: string;
  /** Default "No visits in this range". */
  emptyTitle?: string;
  emptyBody?: string;
  className?: string;
};

/**
 * Top N list (pages, countries, sources) as plain HTML: an `<ol>` of 32 px rows,
 * label left, value right, a `--chart-1` bar behind the label sized to the
 * largest row. Server Component, 0 KB JS. It is real text, so it needs no other
 * alternative; the bar is decorative.
 */
export default function BarList({
  items,
  format = 'count',
  max = 10,
  showShare = false,
  total,
  viewAllHref,
  emptyTitle = 'No visits in this range',
  emptyBody,
  className = '',
}: BarListProps) {
  const rows = items.slice(0, max);
  if (rows.length === 0 || rows.every((r) => r.value <= 0)) {
    return <EmptyState size="inline" icon={<ChartNoAxesColumn />} title={emptyTitle} body={emptyBody} className={className} />;
  }
  const top = Math.max(...rows.map((r) => r.value));
  const base = total ?? items.reduce((sum, r) => sum + Math.max(0, r.value), 0);

  return (
    <div className={`@container ${className}`}>
      <ol className="flex flex-col gap-0.5">
        {rows.map((row, i) => {
          const width = top > 0 ? Math.max(0, (row.value / top) * 100) : 0;
          const body = (
            <>
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 rounded-sm bg-chart-1/12 transition-colors duration-[var(--dur-1)] group-hover:bg-chart-1/20"
                style={{ width: `${width.toFixed(1)}%` }}
              />
              <span className="relative flex min-w-0 flex-1 items-center gap-2 px-2">
                {row.icon && (
                  <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-fg-muted *:size-4">
                    {row.icon}
                  </span>
                )}
                <span title={row.label} className="truncate text-fg">
                  {row.label}
                </span>
              </span>
              <span className="relative shrink-0 px-2 text-right text-fg tabular-nums">{formatValue(row.value, format)}</span>
              {showShare && (
                <span className="relative hidden w-14 shrink-0 pr-2 text-right text-fg-muted tabular-nums @sm:block">
                  {formatShare(row.value, base)}
                </span>
              )}
            </>
          );
          const rowClass = 'group relative flex h-8 items-center text-[13px]';
          return (
            <li key={`${row.label}-${i}`}>
              {row.href ? (
                <Link
                  href={row.href}
                  className={`${rowClass} rounded-sm`}
                >
                  {body}
                </Link>
              ) : (
                <div className={rowClass}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {viewAllHref && (
        <Link
          href={viewAllHref}
          className="mt-2 inline-flex items-center gap-1 rounded-sm px-2 text-[13px] text-brand-text underline-offset-2 pointer-fine:hover:underline"
        >
          View all
          <ArrowRight aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
