'use client';

import { useMemo, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { CalendarRange, Info } from 'lucide-react';
import AdminButton from '@/shared/ui/AdminButton';
import SegmentedControl from '@/shared/ui/SegmentedControl';
import Tooltip from '@/shared/ui/Tooltip';
import DataTable from '@/shared/ui/data-table/DataTable';
import { createAdminColumnHelper, type AdminColumnDef } from '@/shared/ui/data-table/types';
import { formatShare } from '@/shared/ui/charts/format';
import { AVG_TIME_HINT, PAGE_MODE_LABELS, PAGE_MODES, PAGE_SORTS, VISITORS_HINT, type PageMode } from '../constants';
import { formatAvgTime, formatRate, formatScroll, middleTruncate, spokenRate } from '../format';
import type { PageTableRow } from '../rows';

type PagesTableProps = {
  rows: PageTableRow[];
  mode: PageMode;
  /** Rows matching search and mode (all pages). */
  total: number;
  /** Bar scale: the largest primary count of all matching rows. */
  max: number;
  /** Share base: entries (entry mode) or exits (exit mode) of every path. */
  base: number;
  page: { prevCursor: string | null; nextCursor: string | null };
  /** Path whose detail panel is open. */
  openPath: string | null;
  /** `?range=30d` with the other params kept, when the range is shorter. */
  widenHref: string | null;
  /** The range is 30 days or longer: an empty table means "nothing yet". */
  longRange: boolean;
  error?: { title: string; reason: string; errorId?: string };
};

export default function PagesTable({ rows, mode, total, max, base, page, openPath, widenHref, longRange, error }: PagesTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  // A new mode has its own counts and sorts: back to page one, default sort.
  const [{ q }, setView] = useQueryStates(
    { mode: parseAsStringLiteral(PAGE_MODES), cursor: parseAsString, sort: parseAsString, q: parseAsString.withDefault('') },
    { shallow: false, history: 'push', startTransition },
  );

  const columns = useMemo(() => buildColumns(mode, max, base, openPath), [mode, max, base, openPath]);

  // Row click opens the panel (`?path=`); clicking the open row closes it.
  const rowHref = (row: PageTableRow) => {
    if (!row.linkable) return '';
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (row.path === openPath) next.delete('path');
    else next.set('path', row.path);
    const query = next.toString();
    return query ? `${pathname}?${query}` : (pathname ?? '/admin/pages');
  };

  const onMode = (next: PageMode) => void setView({ mode: next === 'all' ? null : next, cursor: null, sort: null });
  const modeItems = (short: boolean) =>
    PAGE_MODES.map((m) => ({ value: m, label: short ? PAGE_MODE_LABELS[m].short : PAGE_MODE_LABELS[m].tab }));

  const filters = (
    <>
      <div className="hidden sm:block">
        <SegmentedControl label="Which pages" size="sm" value={mode} onValueChange={onMode} items={modeItems(false)} />
      </div>
      <div className="sm:hidden">
        <SegmentedControl label="Which pages" size="sm" value={mode} onValueChange={onMode} items={modeItems(true)} />
      </div>
    </>
  );

  return (
    <DataTable<PageTableRow>
      label="Pages"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.path}
      rowLabel={(row) => row.label}
      rowHref={rowHref}
      sort={PAGE_SORTS[mode]}
      page={{ ...page, total }}
      status={error ? 'error' : 'ready'}
      error={error ? { ...error, onRetry: () => startTransition(() => router.refresh()) } : undefined}
      empty={emptyCopy(mode, longRange, widenHref)}
      noResults={{
        title: `No pages match "${q}".`,
        body: 'Search matches the start of a path, like /chat.',
      }}
      search={{ placeholder: 'Search path…' }}
      filters={filters}
    />
  );
}

function emptyCopy(mode: PageMode, longRange: boolean, widenHref: string | null) {
  const what = mode === 'entry' ? 'entry pages' : mode === 'exit' ? 'exit pages' : 'page views';
  const action = widenHref ? (
    <AdminButton href={widenHref} icon={CalendarRange} size="sm">
      Last 30 days
    </AdminButton>
  ) : undefined;
  if (longRange) {
    return { title: `No ${what} yet.`, body: 'Pages appear after the first visit is recorded.', action };
  }
  return {
    title: `No ${what} in this range.`,
    body: 'Pages appear a few seconds after a visit is recorded. A longer range may have some.',
    action,
  };
}

// ---------------------------------------------------------------------------
// Columns

const col = createAdminColumnHelper<PageTableRow>();

/** Only in the phone card (the table hides it from 640 px): "1,833 views". */
const cardOnly = (text: string) => <span className="@[640px]:hidden">{text}</span>;

function headerWithHint(label: string, hint: string) {
  return function Header() {
    return (
      <span className="inline-flex items-center gap-1">
        {label}
        <Tooltip content={hint}>
          <span className="inline-flex">
            <Info aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-fg-faint" />
            <span className="sr-only">{hint}</span>
          </span>
        </Tooltip>
      </span>
    );
  };
}

/** Count with a thin bar under it (share of the largest row). The bar is table-only. */
function CountWithBar({ value, max, suffix }: { value: number; max: number; suffix: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <span className="inline-flex flex-col items-end">
      <span>
        {value.toLocaleString('en-US')}
        {cardOnly(suffix)}
      </span>
      <span aria-hidden="true" className="mt-0.5 hidden h-0.5 w-16 justify-end @[640px]:flex">
        <span className="h-full rounded-full bg-brand/30" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function Rate({ rate, hint, prefix }: { rate: number | null; hint: string; prefix?: string }) {
  const text = formatRate(rate);
  if (text === null) return null;
  return (
    <Tooltip content={hint}>
      <span aria-label={`${prefix ?? ''}${spokenRate(rate)}`}>
        {prefix && cardOnly(prefix)}
        {text}
      </span>
    </Tooltip>
  );
}

function PathCell({ row, open }: { row: PageTableRow; open: boolean }): ReactNode {
  if (!row.linkable) return <span className="text-fg-muted">{row.label}</span>;
  const short = middleTruncate(row.path, 48);
  const text = (
    <span className={`font-mono text-[12.5px] ${open ? 'font-semibold text-fg' : ''}`} aria-current={open || undefined}>
      {short}
    </span>
  );
  return short === row.path ? text : <Tooltip content={row.path}>{text}</Tooltip>;
}

function bouncedHint(row: PageTableRow): string {
  const bounced = Math.round((row.bounceRate ?? 0) * row.entries);
  return `${bounced.toLocaleString('en-US')} of ${row.entries.toLocaleString('en-US')} sessions that started here left after one page`;
}

function exitHint(row: PageTableRow): string {
  return `${row.exits.toLocaleString('en-US')} of ${row.pageviews.toLocaleString('en-US')} views were the last page of a session`;
}

function buildColumns(mode: PageMode, max: number, base: number, openPath: string | null): AdminColumnDef<PageTableRow>[] {
  const path = col.accessor('path', {
    header: 'Path',
    cell: (info) => <PathCell row={info.row.original} open={info.row.original.path === openPath} />,
    meta: { priority: 1, sortable: true, card: 'title' },
  });
  const views = (primary: boolean) =>
    col.accessor('pageviews', {
      header: 'Views',
      cell: (info) =>
        primary ? (
          <CountWithBar value={info.getValue()} max={max} suffix=" views" />
        ) : (
          <span>
            {info.getValue().toLocaleString('en-US')}
            {cardOnly(' views')}
          </span>
        ),
      meta: { priority: primary ? 1 : 2, kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 104, card: primary ? 'meta' : 'hidden' },
    });
  const avgTime = (priority: 2 | 3) =>
    col.accessor('avgEngagedMs', {
      header: headerWithHint('Avg time', AVG_TIME_HINT),
      cell: (info) => {
        const text = formatAvgTime(info.getValue());
        return text === null ? null : (
          <span>
            {text}
            {cardOnly(' avg')}
          </span>
        );
      },
      meta: { priority, label: 'Avg time', kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 112, card: 'meta' },
    });
  const bounce = (priority: 2 | 3, card: 'meta' | 'hidden') =>
    col.accessor('bounceRate', {
      header: 'Bounce',
      cell: (info) => <Rate rate={info.getValue()} hint={bouncedHint(info.row.original)} prefix="bounce " />,
      meta: { priority, kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 96, card },
    });
  const exitRate = (priority: 2 | 3, card: 'meta' | 'hidden') =>
    col.accessor('exitRate', {
      header: 'Exit',
      cell: (info) => <Rate rate={info.getValue()} hint={exitHint(info.row.original)} prefix="exit " />,
      meta: { priority, label: 'Exit rate', kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 88, card },
    });
  const scroll = col.accessor('avgScroll', {
    header: 'Scroll',
    cell: (info) => {
      const text = formatScroll(info.getValue());
      return text === null ? null : <span aria-label={`${text.replace('%', '')} percent scrolled`}>{text}</span>;
    },
    meta: { priority: 3, label: 'Scroll depth', kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 88, card: 'hidden' },
  });
  const sessionCount = (key: 'entries' | 'exits', header: string, suffix: string, hint: string) =>
    col.accessor(key, {
      header,
      cell: (info) => (
        <Tooltip content={`${formatShare(info.getValue(), base)} of all ${hint}`}>
          <span>
            <CountWithBar value={info.getValue()} max={max} suffix={suffix} />
          </span>
        </Tooltip>
      ),
      meta: { priority: 1, kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 104, card: 'meta' },
    });

  if (mode === 'entry') {
    return col.columns([
      path,
      sessionCount('entries', 'Entries', ' entries', 'sessions that started on a tracked page'),
      bounce(2, 'meta'),
      views(false),
      avgTime(3),
      scroll,
    ]);
  }
  if (mode === 'exit') {
    return col.columns([
      path,
      sessionCount('exits', 'Exits', ' exits', 'sessions that ended on a tracked page'),
      exitRate(2, 'meta'),
      views(false),
      avgTime(3),
      scroll,
    ]);
  }
  return col.columns([
    path,
    views(true),
    col.accessor('visitors', {
      header: headerWithHint('Visitors', VISITORS_HINT),
      cell: (info) => info.getValue().toLocaleString('en-US'),
      meta: { priority: 2, label: 'Visitors', kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 104, card: 'hidden' },
    }),
    avgTime(2),
    bounce(2, 'meta'),
    exitRate(3, 'hidden'),
    scroll,
  ]);
}
