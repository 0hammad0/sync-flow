'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { iconButtonClass } from '@/shared/ui/button-styles';
import { crumbsFor, geoHref, parentOf, type GeoTarget } from '../drill';

/**
 * `All countries › Pakistan › PB`, each part a link, plus a back button one
 * level up. Links keep the range, view and sort from the current URL.
 */
export default function GeoBreadcrumb({ target }: { target: GeoTarget }) {
  const search = useSearchParams();
  const crumbs = crumbsFor(target);
  const parent = parentOf(target);
  const parentLabel = parent ? crumbsFor(parent).at(-1)!.label : null;

  return (
    <div className="flex min-h-8 min-w-0 items-center gap-1">
      {parent && (
        <Link
          href={geoHref(search, parent)}
          aria-label={`Back to ${parentLabel}`}
          title={`Back to ${parentLabel}`}
          className={iconButtonClass('-ml-1.5 shrink-0')}
        >
          <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="size-4" />
        </Link>
      )}
      <nav aria-label="Location level" className="min-w-0">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
          {crumbs.map((crumb, i) => (
            <Fragment key={crumb.label}>
              {i > 0 && (
                <li aria-hidden="true" className="flex text-fg-faint">
                  <ChevronRight strokeWidth={1.75} className="size-3.5" />
                </li>
              )}
              <li className="min-w-0">
                {crumb.current ? (
                  <span aria-current="page" className="block truncate font-medium text-fg">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={geoHref(search, crumb.target)}
                    className="block truncate rounded-sm text-fg-muted underline-offset-2 pointer-fine:hover:text-fg pointer-fine:hover:underline"
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
    </div>
  );
}
