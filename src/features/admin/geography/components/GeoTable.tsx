'use client';

import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight, List } from 'lucide-react';
import DataTable from '@/shared/ui/data-table/DataTable';
import { createAdminColumnHelper, type AdminColumnDef } from '@/shared/ui/data-table/types';
import { formatDuration, formatShare, formatValue } from '@/shared/ui/charts/format';
import { geoHref, parentOf, type GeoLevel, type GeoTarget } from '../drill';
import { GEO_SORT, type GeoRow } from '../rows';

const LABELS: Record<GeoLevel, string> = { country: 'Countries', region: 'Regions', city: 'Cities' };

type GeoTableProps = {
  level: GeoLevel;
  target: GeoTarget;
  /** One page, already sorted (rows.ts). */
  rows: GeoRow[];
  page: { prevCursor: string | null; nextCursor: string | null; total: number };
  empty: { title: string; body?: ReactNode; action?: ReactNode; illustration?: ReactNode };
  error?: { title: string; reason: string; errorId?: string; retry: boolean };
  /** Toolbar right side: `[Export CSV]`. */
  actions?: ReactNode;
};

const INPUTS = 'input, textarea, select, [contenteditable="true"]';

/**
 * Places of one level (07-geography.md): the full, accessible version of the
 * map. Rows drill in (country → regions → cities); city rows do not.
 * `Backspace` in the table goes one level up.
 */
export default function GeoTable({ level, target, rows, page, empty, error, actions }: GeoTableProps) {
  const router = useRouter();
  const search = useSearchParams();
  const columns = useMemo(() => buildColumns(level), [level]);
  const parent = parentOf(target);

  const hrefOf = (row: GeoRow) => (row.drill ? geoHref(search, row.drill) : '');

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Backspace' || !parent || event.defaultPrevented) return;
    if ((event.target as HTMLElement).closest(INPUTS)) return;
    event.preventDefault();
    router.push(geoHref(search, parent));
  };

  const sessionsHref = (code: string) => {
    const params = new URLSearchParams();
    for (const key of ['range', 'from', 'to']) {
      const value = search.get(key);
      if (value) params.set(key, value);
    }
    params.set('country', code);
    return `/admin/sessions?${params.toString()}`;
  };

  return (
    // Key events bubble up from the focused row link; the div itself is not a tab stop.
    <div onKeyDown={onKeyDown}>
      <DataTable<GeoRow>
        label={LABELS[level]}
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        rowLabel={(row) => row.label}
        rowHref={hrefOf}
        sort={GEO_SORT}
        page={page}
        status={error ? 'error' : 'ready'}
        error={error ? { ...error, onRetry: error.retry ? () => router.refresh() : undefined } : undefined}
        empty={empty}
        actions={actions}
        rowActions={
          level === 'country'
            ? (row) =>
                row.code
                  ? [{ type: 'item', label: 'Sessions from here', icon: List, onSelect: () => router.push(sessionsHref(row.code!)) }]
                  : []
            : undefined
        }
      />
    </div>
  );
}

const col = createAdminColumnHelper<GeoRow>();

/** Words shown after a number on phone cards only: the table has headers for them. */
function CardUnit({ children }: { children: string }) {
  return <span className="@[640px]:hidden"> {children}</span>;
}

function ShareCell({ share }: { share: number }) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden="true" className="h-0.5 w-10 overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full rounded-full bg-chart-1" style={{ width: `${pct.toFixed(1)}%` }} />
      </span>
      <span className="tabular-nums">{formatShare(share, 1)}</span>
    </span>
  );
}

function buildColumns(level: GeoLevel): AdminColumnDef<GeoRow>[] {
  return col.columns([
    col.accessor('label', {
      id: 'place',
      header: 'Place',
      cell: (info) => {
        const row = info.row.original;
        return (
          <span className="inline-flex max-w-full min-w-0 items-center gap-2 align-middle">
            {level === 'country' && (
              <span aria-hidden="true" className="w-5 shrink-0 font-mono text-[11.5px] text-fg-faint">
                {row.code ?? ''}
              </span>
            )}
            <span title={row.label} className={`truncate ${row.unknown || row.other ? 'text-fg-muted' : ''}`}>
              {row.label}
            </span>
            {row.drill && <ChevronRight aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0 text-fg-faint" />}
          </span>
        );
      },
      meta: { priority: 1, sortable: true, card: 'title' },
    }),
    col.accessor('visitors', {
      header: 'Visitors',
      cell: (info) => (
        <span className="tabular-nums">
          {formatValue(info.getValue())}
          <CardUnit>{info.getValue() === 1 ? 'visitor' : 'visitors'}</CardUnit>
        </span>
      ),
      meta: { priority: 1, kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 96, card: 'trailing' },
    }),
    col.accessor('pageviews', {
      header: 'Page views',
      cell: (info) => formatValue(info.getValue()),
      meta: { priority: 2, kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 104, card: 'hidden' },
    }),
    col.accessor('avgTimeS', {
      id: 'avg_time',
      header: 'Avg time',
      cell: (info) => {
        const value = info.getValue();
        return value === null ? null : formatDuration(value);
      },
      meta: { priority: 2, kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 96, label: 'Average time', card: 'hidden' },
    }),
    col.accessor('bouncePct', {
      id: 'bounce',
      header: 'Bounce',
      cell: (info) => {
        const value = info.getValue();
        return value === null ? null : formatValue(Math.round(value), 'percent');
      },
      meta: { priority: 3, kind: 'number', align: 'right', sortable: true, defaultDesc: true, width: 88, label: 'Bounce rate', card: 'hidden' },
    }),
    col.accessor('share', {
      header: 'Share',
      cell: (info) => <ShareCell share={info.getValue()} />,
      meta: { priority: 1, kind: 'number', align: 'right', width: 104, card: 'meta' },
    }),
  ]);
}
