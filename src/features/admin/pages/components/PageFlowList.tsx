import type { FlowRow } from '@/features/admin/analytics/types';
import BarList, { type BarListItem } from '@/shared/ui/charts/BarList';
import { isKnownPath, pagePathLabel } from '../constants';

/** "Started here" / "Left the site" for the session edges, the path otherwise. */
export function flowLabel(row: FlowRow): string {
  if (row.kind === 'entry') return 'Started here';
  if (row.kind === 'exit') return 'Left the site';
  return row.path === null ? 'Unknown page' : pagePathLabel(row.path);
}

/** Flow rows → BarList items. Known paths link to their own panel. */
export function flowItems(rows: FlowRow[], hrefFor: (path: string) => string): BarListItem[] {
  return rows.map((row) => ({
    label: flowLabel(row),
    value: row.count,
    href: row.kind === 'page' && isKnownPath(row.path) ? hrefFor(row.path) : undefined,
  }));
}

/** Came from / went to: top 5 with their share of the times this page was viewed. */
export default function PageFlowList({
  title,
  rows,
  occurrences,
  hrefFor,
}: {
  title: string;
  rows: FlowRow[];
  occurrences: number;
  hrefFor: (path: string) => string;
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1.5 text-[13px] font-medium text-fg">{title}</h3>
      <BarList
        items={flowItems(rows, hrefFor)}
        max={5}
        showShare
        total={occurrences}
        emptyTitle="No views of this page in the sample"
      />
    </section>
  );
}
