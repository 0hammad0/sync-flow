'use client';

import { useMemo, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { CalendarRange, ChevronRight, ExternalLink, Info } from 'lucide-react';
import AdminButton from '@/shared/ui/AdminButton';
import SegmentedControl from '@/shared/ui/SegmentedControl';
import Tooltip from '@/shared/ui/Tooltip';
import DataTable from '@/shared/ui/data-table/DataTable';
import { createAdminColumnHelper, type AdminColumnDef } from '@/shared/ui/data-table/types';
import { formatRate, plural, spokenRate } from '@/features/admin/pages/format';
import {
  DIM_HEADERS,
  DIM_PLURALS,
  DRILL_PARAM,
  MAX_LABEL_CHARS,
  SOURCE_SORT,
  UTM_FIELD_LABELS,
  UTM_FIELDS,
  type SourceDimKey,
  type SourceTab,
  type UtmField,
} from '../constants';
import { truncateLabel, type SourceTableRow } from '../rows';

type SourceTableProps = {
  tab: SourceTab;
  utm: UtmField;
  dim: SourceDimKey;
  rows: SourceTableRow[];
  total: number;
  page: { prevCursor: string | null; nextCursor: string | null };
  /** Drill key of the open row (`?host=` / `?browser=`). */
  openDrill: string | null;
  /** `none`: nothing recorded. `no-tags`: visits, but none with a UTM tag. */
  emptyKind: 'none' | 'no-tags';
  /** Visits without a tag (UTM tab, `no-tags`). */
  untagged: number;
  widenHref: string | null;
  longRange: boolean;
  error?: { title: string; reason: string; errorId?: string };
};

export default function SourceTable({
  tab,
  utm,
  dim,
  rows,
  total,
  page,
  openDrill,
  emptyKind,
  untagged,
  widenHref,
  longRange,
  error,
}: SourceTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [, setParams] = useQueryStates(
    { utm: parseAsStringLiteral(UTM_FIELDS), cursor: parseAsString, sort: parseAsString },
    { shallow: false, history: 'push', startTransition },
  );
  const drillParam = DRILL_PARAM[tab];
  const columns = useMemo(() => buildColumns(tab, dim, openDrill), [tab, dim, openDrill]);

  // A drillable row toggles its drill in the URL; the server renders it under the table.
  const rowHref = (row: SourceTableRow) => {
    if (!drillParam || !row.drillKey) return '';
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (row.drillKey === openDrill) next.delete(drillParam);
    else next.set(drillParam, row.drillKey);
    const query = next.toString();
    return query ? `${pathname}?${query}` : (pathname ?? '/admin/sources');
  };

  const filters =
    tab === 'utm' ? (
      <SegmentedControl
        label="UTM field"
        size="sm"
        value={utm}
        onValueChange={(next) => void setParams({ utm: next === 'source' ? null : next, cursor: null })}
        items={UTM_FIELDS.map((f) => ({ value: f, label: UTM_FIELD_LABELS[f] }))}
      />
    ) : undefined;

  return (
    <DataTable<SourceTableRow>
      label={DIM_PLURALS[dim]}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      rowLabel={(row) => row.label}
      rowHref={rowHref}
      sort={SOURCE_SORT}
      page={{ ...page, total }}
      status={error ? 'error' : 'ready'}
      error={error ? { ...error, onRetry: () => startTransition(() => router.refresh()) } : undefined}
      empty={emptyCopy(emptyKind, untagged, longRange, widenHref)}
      filters={filters}
    />
  );
}

function emptyCopy(kind: 'none' | 'no-tags', untagged: number, longRange: boolean, widenHref: string | null) {
  if (kind === 'no-tags') {
    return {
      title: 'No UTM tags in this range.',
      body: (
        <>
          Add <code className="font-mono text-[12.5px]">?utm_source=</code> to links you share.{' '}
          {untagged > 0 && `${plural(untagged, 'visit')} came without one.`}
        </>
      ),
    };
  }
  const action = widenHref ? (
    <AdminButton href={widenHref} icon={CalendarRange} size="sm">
      Last 30 days
    </AdminButton>
  ) : undefined;
  return longRange
    ? { title: 'No visits yet.', body: 'Sources appear after the first visit is recorded.', action }
    : { title: 'No visits in this range.', body: 'Sources appear a few seconds after a visit is recorded. A longer range may have some.', action };
}

// ---------------------------------------------------------------------------
// Columns

const col = createAdminColumnHelper<SourceTableRow>();

const cardOnly = (text: string) => <span className="@[640px]:hidden">{text}</span>;

function LabelCell({ row, open }: { row: SourceTableRow; open: boolean }): ReactNode {
  const short = truncateLabel(row.label, MAX_LABEL_CHARS);
  const text = <span className={row.bucket ? 'text-fg-muted' : 'text-fg'}>{short}</span>;
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      {row.drillKey && (
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={`size-3.5 shrink-0 text-fg-faint transition-transform duration-[120ms] ${open ? 'rotate-90' : ''}`}
        />
      )}
      {short === row.label ? text : <Tooltip content={row.label}>{text}</Tooltip>}
      {open && <span className="sr-only">, details shown below the table</span>}
    </span>
  );
}

function ShareCell({ share }: { share: number }) {
  const pct = Math.round(share * 1000) / 10;
  const text = formatRate(share) ?? '0%';
  return (
    <span className="inline-flex items-center gap-2" aria-label={spokenRate(share)}>
      <span aria-hidden="true" className="hidden h-1 w-12 overflow-hidden rounded-full bg-surface-3 @[640px]:inline-flex">
        <span className="h-full rounded-full bg-brand/40" style={{ width: `${Math.max(pct, share > 0 ? 2 : 0)}%` }} />
      </span>
      <span>{text}</span>
    </span>
  );
}

/** Phone card only: a full-width share bar under "812 visitors · 63%". */
function CardShareBar({ share }: { share: number }) {
  return (
    <span aria-hidden="true" className="mt-1.5 flex h-1 w-full overflow-hidden rounded-full bg-surface-3 @[640px]:hidden">
      <span className="h-full rounded-full bg-brand/40" style={{ width: `${Math.max(Math.round(share * 100), share > 0 ? 2 : 0)}%` }} />
    </span>
  );
}

function bouncedHint(row: SourceTableRow): string {
  const bounced = Math.round((row.bounceRate ?? 0) * row.sessions);
  return `${bounced.toLocaleString('en-US')} of ${row.sessions.toLocaleString('en-US')} sessions left after one page`;
}

function buildColumns(tab: SourceTab, dim: SourceDimKey, openDrill: string | null): AdminColumnDef<SourceTableRow>[] {
  const label = col.accessor('label', {
    header: DIM_HEADERS[dim],
    cell: (info) => <LabelCell row={info.row.original} open={info.row.original.drillKey !== null && info.row.original.drillKey === openDrill} />,
    meta: { priority: 1, sortable: true, card: 'title' },
  });
  const openSite = col.display({
    id: 'open',
    header: () => <span className="sr-only">Open site</span>,
    cell: (info) => {
      const row = info.row.original;
      if (!row.externalUrl) return null;
      return (
        <a
          href={row.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${row.label} in a new tab`}
          className="inline-flex size-7 items-center justify-center rounded-md text-fg-faint pointer-coarse:size-10 pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg"
        >
          <ExternalLink aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
        </a>
      );
    },
    meta: { priority: 2, label: 'Open site', width: 48, card: 'hidden' },
  });
  const columns: AdminColumnDef<SourceTableRow>[] = [
    label,
    ...(tab === 'referrers' ? [openSite] : []),
    col.accessor('visitors', {
      header: () => (
        <span className="inline-flex items-center gap-1">
          Visitors
          <Tooltip content="Counted per browser tab session.">
            <span className="inline-flex">
              <Info aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-fg-faint" />
              <span className="sr-only">Counted per browser tab session.</span>
            </span>
          </Tooltip>
        </span>
      ),
      cell: (info) => (
        <span>
          {info.getValue().toLocaleString('en-US')}
          {cardOnly(info.getValue() === 1 ? ' visitor' : ' visitors')}
        </span>
      ),
      meta: { priority: 1, label: 'Visitors', kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 104, card: 'meta' },
    }),
    col.accessor('pageviews', {
      header: 'Views',
      cell: (info) => info.getValue().toLocaleString('en-US'),
      meta: { priority: 3, kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 96, card: 'hidden' },
    }),
    col.accessor('bounceRate', {
      header: 'Bounce',
      cell: (info) => {
        const text = formatRate(info.getValue());
        return text === null ? null : (
          <Tooltip content={bouncedHint(info.row.original)}>
            <span aria-label={spokenRate(info.getValue())}>{text}</span>
          </Tooltip>
        );
      },
      meta: { priority: 2, kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 88, card: 'hidden' },
    }),
    col.accessor('share', {
      header: 'Share',
      cell: (info) => (
        <>
          <ShareCell share={info.getValue()} />
          <CardShareBar share={info.getValue()} />
        </>
      ),
      meta: { priority: 1, kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 112, card: 'meta' },
    }),
  ];
  return columns;
}
