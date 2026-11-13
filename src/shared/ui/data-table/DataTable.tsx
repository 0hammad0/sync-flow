'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createSerializer } from 'nuqs';
import {
  flexRender,
  useTable,
  type Cell,
  type Header,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox, SearchX } from 'lucide-react';
import Checkbox from '@/shared/ui/Checkbox';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';
import BulkBar from './BulkBar';
import ColumnMenu from './ColumnMenu';
import MobileCardList from './MobileCardList';
import Pagination from './Pagination';
import RowActions, { type RowAction } from './RowActions';
import TableSkeleton, { CardListSkeleton, type SkeletonColumn } from './TableSkeleton';
import Toolbar from './Toolbar';
import {
  adminTableFeatures,
  CARD_BREAKPOINT,
  type AdminColumnDef,
  type AdminColumnMeta,
  type AdminTableFeatures,
  type BulkSelection,
  type Density,
} from './types';
import { createTableParsers, nextSort, parseSort, type SortConfig } from './url-state';
import { useTableUrlState } from './useTableUrlState';
import { PRIORITY_CELL, SECONDARY_BUTTON } from './styles';

export type DataTableProps<TData extends RowData> = {
  /** What the rows are, plural: "Sessions". Table caption (sr-only) and list name. */
  label: string;
  /** From `createAdminColumnHelper<Row>().columns([...])`. Keep the array stable (module constant or useMemo). */
  columns: AdminColumnDef<TData>[];
  /** This page, already filtered, sorted and paged by the server. */
  rows: TData[];
  getRowId: (row: TData) => string;
  /** Short name of one row for labels: "Actions for {x}", "Select {x}". */
  rowLabel: (row: TData) => string;
  /** Detail page. Makes the first P1 cell (and each card) a real link; the row forwards clicks to it. */
  rowHref?: (row: TData) => string;
  /** Indexed sorts only. `?sort=` outside this list falls back to `default`. */
  sort: SortConfig;
  /** Cursor paging. `prevCursor: null` on the first page, `FIRST_PAGE_CURSOR` when the newer page is the first. */
  page: { prevCursor: string | null; nextCursor: string | null; total?: number | null };
  /** `load-more` for Firebase Auth page tokens (Users). */
  pagination?: 'cursor' | 'load-more';
  /** `loading` = first load (skeleton). Refreshes after a URL change are tracked here and keep the old rows. */
  status?: 'ready' | 'loading' | 'error';
  error?: { title: string; reason: string; errorId?: string; onRetry?: () => void };
  /** Nothing exists yet. */
  empty: { title: string; body?: ReactNode; action?: ReactNode; illustration?: ReactNode };
  /** Search or filters match nothing. */
  noResults?: { title: string; body?: ReactNode };
  search?: { placeholder: string };
  /** Filter chips. Their setters must also clear `cursor` (back to the first page). */
  filters?: ReactNode;
  activeFilters?: number;
  onClearFilters?: () => void;
  /** Toolbar right side, e.g. `[Export CSV]`. */
  actions?: ReactNode;
  /** Items this role may use for a row. When no row has any, the column is hidden. */
  rowActions?: (row: TData) => RowAction[];
  /** Turns on row selection. Rendered in the BulkBar. */
  bulkActions?: (selection: BulkSelection, clear: () => void) => ReactNode;
  /** Default from the `sf_admin_density` cookie (read by the page). `?density=` overrides it. */
  defaultDensity?: Density;
  /** `cards` under a 640 px container (lists), or `scroll`: a real table that scrolls both ways (compare numbers). */
  mobile?: 'cards' | 'scroll';
};

/** Which layout a table container of this width gets. `null` width = not measured yet (SSR). */
export function tableViewFor(width: number | null, mobile: 'cards' | 'scroll'): 'table' | 'cards' | 'css' {
  if (mobile === 'scroll') return 'table';
  if (width === null) return 'css';
  return width < CARD_BREAKPOINT ? 'cards' : 'table';
}

function useContainerWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

// Default density keeps the :root --admin-row-h (40 px).
const ROW_HEIGHT: Record<Density, string | undefined> = {
  compact: 'var(--admin-row-h-compact)',
  default: undefined,
  comfortable: 'var(--admin-row-h-comfortable)',
};

const metaOf = (column: { columnDef: { meta?: AdminColumnMeta } }): AdminColumnMeta =>
  column.columnDef.meta ?? { priority: 1 };

function headerLabel<TData extends RowData>(header: Header<AdminTableFeatures, TData, unknown>) {
  const meta = metaOf(header.column);
  const def = header.column.columnDef.header;
  return meta.label ?? (typeof def === 'string' ? def : header.column.id);
}

const INTERACTIVE = 'a, button, input, label, select, textarea, [role="checkbox"], [role="menuitem"]';

/**
 * The one table for every admin list (08-tables.md). Server mode: the page
 * fetches one cursor page with the URL's sort/filter/search and passes the
 * rows in; every control writes the URL (nuqs, `shallow: false`) and the
 * Server Component re-queries. TanStack Table v9 only holds view state.
 */
export default function DataTable<TData extends RowData>({
  label,
  columns,
  rows,
  getRowId,
  rowLabel,
  rowHref,
  sort: sortConfig,
  page,
  pagination = 'cursor',
  status = 'ready',
  error,
  empty,
  noResults,
  search,
  filters,
  activeFilters = 0,
  onClearFilters,
  actions,
  rowActions,
  bulkActions,
  defaultDensity = 'default',
  mobile = 'cards',
}: DataTableProps<TData>) {
  const url = useTableUrlState(sortConfig, defaultDensity);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(rootRef);
  const view = tableViewFor(width, mobile);

  // --- Selection: per page. Ticked rows clear on a page change; "all matching" stays.
  const selectable = Boolean(bulkActions);
  const [selection, setSelection] = useState<{ cursor: string | null; rows: RowSelectionState }>({
    cursor: url.cursor,
    rows: {},
  });
  const [allMatching, setAllMatching] = useState(false);
  const rowSelection = selection.cursor === url.cursor ? selection.rows : {};
  const lastToggled = useRef<number | null>(null);
  const shiftHeld = useRef(false);

  // --- Sorting and visibility come from the URL.
  const sorting = useMemo<SortingState>(() => [parseSort(url.sort)], [url.sort]);
  const lockedIds = useMemo(
    () => new Set(columns.filter((c) => (c.meta?.priority ?? 1) === 1).map((c) => columnId(c))),
    [columns],
  );
  const columnVisibility = useMemo(
    () => Object.fromEntries(url.hiddenColumns.filter((id) => !lockedIds.has(id)).map((id) => [id, false])),
    [url.hiddenColumns, lockedIds],
  );

  const table = useTable({
    features: adminTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => getRowId(row),
    manualSorting: true,
    enableMultiSort: false,
    enableRowSelection: selectable,
    state: { sorting, rowSelection, columnVisibility },
    onRowSelectionChange: (updater) =>
      setSelection({
        cursor: url.cursor,
        rows: typeof updater === 'function' ? updater(rowSelection) : updater,
      }),
  });

  const tableRows = table.getRowModel().rows;
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const selectedCount = selectedIds.length;
  const clearSelection = () => {
    setSelection({ cursor: url.cursor, rows: {} });
    setAllMatching(false);
  };

  const toggleRow = (row: Row<AdminTableFeatures, TData>, checked: boolean) => {
    const index = tableRows.findIndex((r) => r.id === row.id);
    const next = { ...rowSelection };
    if (shiftHeld.current && lastToggled.current !== null) {
      // Shift+click: the whole range on this page takes the new state.
      const [from, to] = [Math.min(lastToggled.current, index), Math.max(lastToggled.current, index)];
      for (const r of tableRows.slice(from, to + 1)) {
        if (checked) next[r.id] = true;
        else delete next[r.id];
      }
    } else if (checked) next[row.id] = true;
    else delete next[row.id];
    shiftHeld.current = false;
    lastToggled.current = index;
    if (!checked) setAllMatching(false);
    setSelection({ cursor: url.cursor, rows: next });
  };

  // --- Links
  const serialize = useMemo(() => createSerializer(createTableParsers(sortConfig)), [sortConfig]);
  const hrefFor = (cursor: string | null) =>
    `${pathname}${serialize(new URLSearchParams(searchParams?.toString() ?? ''), { cursor: cursor || null })}`;
  const prefetch = (href: string) => router.prefetch(href);

  const showActions = Boolean(rowActions) && rows.some((row) => rowActions!(row).length > 0);
  const isFiltered = Boolean(url.q) || activeFilters > 0;
  const isEmpty = status === 'ready' && rows.length === 0;
  const columnCount = table.getVisibleLeafColumns().length + (selectable ? 1 : 0) + (showActions ? 1 : 0);
  const visibleLeafIds = new Set(table.getVisibleLeafColumns().map((c) => c.id));

  const skeletonColumns: SkeletonColumn[] = table
    .getHeaderGroups()[0]
    .headers.filter((h) => visibleLeafIds.has(h.column.id))
    .map((h) => {
      const meta = metaOf(h.column);
      return { id: h.column.id, label: headerLabel(h), priority: meta.priority, align: meta.align, width: meta.width };
    });

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && (selectedCount > 0 || allMatching) && !event.defaultPrevented) clearSelection();
  };

  const toolbar =
    selectable && (selectedCount > 0 || allMatching) ? (
      <BulkBar
        count={selectedCount}
        totalMatching={page.total}
        allMatching={allMatching}
        onSelectAllMatching={() => setAllMatching(true)}
        onClear={clearSelection}
      >
        {bulkActions!(
          allMatching && page.total != null
            ? { allMatching: true, total: page.total }
            : { allMatching: false, ids: selectedIds },
          clearSelection,
        )}
      </BulkBar>
    ) : (
      <Toolbar
        search={search && { value: url.q, onChange: url.setQuery, placeholder: search.placeholder }}
        filters={filters}
        activeFilters={activeFilters}
        onClearFilters={onClearFilters}
        resultCount={page.total}
        actions={actions}
        columnMenu={
          <ColumnMenu
            columns={table.getAllLeafColumns().map((column) => ({
              id: column.id,
              label: metaOf(column).label ?? (typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id),
              visible: column.getIsVisible(),
              locked: lockedIds.has(column.id),
            }))}
            onToggle={(id, visible) =>
              url.setHiddenColumns(visible ? url.hiddenColumns.filter((c) => c !== id) : [...url.hiddenColumns, id])
            }
            density={url.density}
            onDensityChange={url.setDensity}
          />
        }
      />
    );

  // --- Body states shared by table and cards
  const stateRow = (content: ReactNode) => (
    <tr>
      <td colSpan={columnCount} className="px-3">
        {content}
      </td>
    </tr>
  );
  const emptyView = isFiltered ? (
    <EmptyState
      size="inline"
      icon={<SearchX aria-hidden="true" strokeWidth={1.75} className="size-4" />}
      title={noResults?.title ?? `No ${label.toLowerCase()} match`}
      body={noResults?.body ?? 'Try a different search or clear the filters.'}
      role="status"
    />
  ) : (
    <EmptyState
      size="inline"
      illustration={empty.illustration}
      icon={empty.illustration ? undefined : <Inbox aria-hidden="true" strokeWidth={1.75} className="size-4" />}
      title={empty.title}
      body={empty.body}
      action={empty.action}
    />
  );
  const errorView = error ? (
    <ErrorState
      size="inline"
      title={error.title}
      reason={error.reason}
      errorId={error.errorId}
      action={
        error.onRetry && (
          <button type="button" onClick={error.onRetry} className={SECONDARY_BUTTON}>
            Retry
          </button>
        )
      }
    />
  ) : null;

  const scroll = mobile === 'scroll';
  const tableView = (
    <div
      data-scroll={scroll || undefined}
      className={
        scroll
          ? 'relative max-h-[calc(100dvh-var(--admin-topbar-h)-16px)] overflow-auto'
          : // `clip`, not `auto`: a scroll container would break the page-level sticky header.
            'relative overflow-x-clip'
      }
    >
      {url.refreshing && (
        <div aria-hidden="true" className="absolute inset-x-0 top-0 z-[3] h-0.5 animate-pulse bg-brand" />
      )}
      {status === 'loading' ? (
        <TableSkeleton
          label={`Loading ${label.toLowerCase()}`}
          columns={skeletonColumns}
          selectable={selectable}
          withActions={showActions}
        />
      ) : (
        <table aria-busy={url.refreshing || undefined} className="w-full border-collapse text-[13px] text-fg">
          <caption className="sr-only">{label}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {selectable && (
                  <th scope="col" className={`${TH} ${stickyTop(scroll)} w-10 px-3`}>
                    <Checkbox
                      aria-label="Select all on this page"
                      checked={
                        table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false
                      }
                      onCheckedChange={(checked) => {
                        if (!checked) setAllMatching(false);
                        table.toggleAllPageRowsSelected(checked);
                      }}
                    />
                  </th>
                )}
                {group.headers.map((header, i) => (
                  <HeaderCell
                    key={header.id}
                    header={header}
                    sortConfig={sortConfig}
                    currentSort={url.sort}
                    onSort={url.setSort}
                    stickyLeft={scroll && i === 0 && !selectable}
                    scroll={scroll}
                    table={table}
                  />
                ))}
                {showActions && (
                  <th scope="col" className={`${TH} ${stickyTop(scroll)} w-12`}>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            ))}
          </thead>
          <tbody className={url.refreshing ? 'opacity-60' : undefined}>
            {status === 'error'
              ? stateRow(errorView)
              : isEmpty
                ? stateRow(emptyView)
                : tableRows.map((row) => {
                    const href = rowHref?.(row.original);
                    const selected = row.getIsSelected();
                    return (
                      <tr
                        key={row.id}
                        data-state={selected ? 'selected' : undefined}
                        onClick={href ? forwardRowClick : undefined}
                        onPointerEnter={href ? () => prefetch(href) : undefined}
                        className={`group h-[var(--admin-row-h)] border-b border-edge pointer-coarse:h-12 data-[state=selected]:bg-surface-3 pointer-fine:hover:bg-surface-2 ${href ? 'cursor-pointer' : ''}`}
                      >
                        {selectable && (
                          <td
                            className="w-10 px-3"
                            onClickCapture={(event) => {
                              shiftHeld.current = event.shiftKey;
                            }}
                          >
                            <Checkbox
                              checked={selected}
                              onCheckedChange={(checked) => toggleRow(row, checked)}
                              aria-label={`Select ${rowLabel(row.original)}`}
                            />
                          </td>
                        )}
                        {row.getVisibleCells().map((cell, i) => (
                          <BodyCell
                            key={cell.id}
                            cell={cell}
                            href={i === firstLinkIndex(row) ? href : undefined}
                            stickyLeft={scroll && i === 0 && !selectable}
                          />
                        ))}
                        {showActions && (
                          <td className="w-12 pr-2 text-right">
                            <RowActions
                              label={`Actions for ${rowLabel(row.original)}`}
                              items={rowActions!(row.original)}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
          </tbody>
        </table>
      )}
    </div>
  );

  const cardsView =
    status === 'loading' ? (
      <CardListSkeleton label={`Loading ${label.toLowerCase()}`} />
    ) : status === 'error' ? (
      <div className="px-3">{errorView}</div>
    ) : isEmpty ? (
      <div className="px-3">{emptyView}</div>
    ) : (
      <MobileCardList
        label={label}
        rows={tableRows}
        rowHref={rowHref}
        onRowHover={prefetch}
        selectable={selectable}
        onToggleRow={toggleRow}
        rowLabel={rowLabel}
        refreshing={url.refreshing}
        renderActions={
          showActions
            ? (row) => <RowActions label={`Actions for ${rowLabel(row)}`} items={rowActions!(row)} className="opacity-100!" />
            : undefined
        }
      />
    );

  const showFooter = status === 'ready' && !isEmpty;

  return (
    <div
      ref={rootRef}
      data-density={url.density}
      onKeyDown={onRootKeyDown}
      style={ROW_HEIGHT[url.density] ? ({ '--admin-row-h': ROW_HEIGHT[url.density] } as CSSProperties) : undefined}
      className="@container rounded-lg border border-edge bg-surface"
    >
      {toolbar}
      {view === 'table' && tableView}
      {view === 'cards' && cardsView}
      {view === 'css' && (
        // Not measured yet (server render): CSS container queries pick the layout,
        // so the first paint is already right. One of the two is display:none.
        <>
          <div className="hidden @[640px]:block">{tableView}</div>
          <div className="@[640px]:hidden">{cardsView}</div>
        </>
      )}
      {showFooter && (
        <Pagination
          mode={pagination}
          prevCursor={page.prevCursor}
          nextCursor={page.nextCursor}
          shown={rows.length}
          total={page.total}
          hrefFor={hrefFor}
          onNavigate={url.setCursor}
          className="border-t border-edge"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const TH = 'h-9 border-b border-edge bg-surface-2 text-left text-xs font-medium text-fg-muted';
const stickyTop = (scroll: boolean) =>
  // Page mode sticks under the admin top bar; scroll mode inside its wrapper.
  // Landscape phones: not sticky (it would cover a quarter of the screen).
  scroll ? 'sticky top-0 z-[2] short:static' : 'sticky top-[var(--admin-topbar-h)] z-[2] short:static';
const STICKY_LEFT = 'sticky left-0 z-[1] border-r border-edge bg-surface';

function columnId<TData extends RowData>(column: AdminColumnDef<TData>): string {
  if (column.id) return column.id;
  if ('accessorKey' in column && column.accessorKey) return String(column.accessorKey).replaceAll('.', '_');
  return '';
}

/** The row link lives in the first visible P1 cell. */
function firstLinkIndex<TData extends RowData>(row: Row<AdminTableFeatures, TData>) {
  const index = row.getVisibleCells().findIndex((cell) => metaOf(cell.column).priority === 1);
  return index === -1 ? 0 : index;
}

/** Row click → its link, unless the click hit a control or the user is selecting text. */
function forwardRowClick(event: MouseEvent<HTMLTableRowElement>) {
  const target = event.target as HTMLElement;
  if (target.closest(INTERACTIVE)) return;
  if (window.getSelection()?.toString()) return;
  const link = event.currentTarget.querySelector<HTMLAnchorElement>('a[data-row-link]');
  link?.dispatchEvent(
    new window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    }),
  );
}

type TableInstance<TData extends RowData> = ReturnType<typeof useTable<AdminTableFeatures, TData>>;

function HeaderCell<TData extends RowData>({
  header,
  sortConfig,
  currentSort,
  onSort,
  stickyLeft,
  scroll,
  table,
}: {
  header: Header<AdminTableFeatures, TData, unknown>;
  sortConfig: SortConfig;
  currentSort: string;
  onSort: (value: string) => void;
  stickyLeft: boolean;
  scroll: boolean;
  table: TableInstance<TData>;
}) {
  const meta = metaOf(header.column);
  const id = header.column.id;
  const sortable = Boolean(meta.sortable) && sortConfig.allowed.includes(id);
  const sorted = header.column.getIsSorted();
  const right = meta.align === 'right';
  const content = header.isPlaceholder ? null : <table.FlexRender header={header} />;
  const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;

  return (
    <th
      scope="col"
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
      style={meta.width ? { width: meta.width } : undefined}
      className={`${TH} ${stickyTop(scroll)} ${stickyLeft ? `${STICKY_LEFT} z-[3] bg-surface-2` : ''} ${right ? 'text-right' : ''} ${PRIORITY_CELL[meta.priority]} ${sortable ? 'p-0' : 'px-3'}`}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort(nextSort(currentSort, id, Boolean(meta.defaultDesc), sortConfig.default))}
          className={`group/sort inline-flex h-9 w-full cursor-pointer items-center gap-1 px-3 font-medium focus-visible:-outline-offset-2 pointer-fine:hover:text-fg ${right ? 'flex-row-reverse' : ''} ${sorted ? 'text-fg' : ''}`}
        >
          {content}
          <SortIcon
            aria-hidden="true"
            strokeWidth={1.75}
            className={`size-3.5 shrink-0 ${sorted ? 'text-fg' : 'text-fg-faint pointer-fine:opacity-0 pointer-fine:group-hover/sort:opacity-100 pointer-fine:group-focus-visible/sort:opacity-100'}`}
          />
        </button>
      ) : (
        content
      )}
    </th>
  );
}

function BodyCell<TData extends RowData>({
  cell,
  href,
  stickyLeft,
}: {
  cell: Cell<AdminTableFeatures, TData, unknown>;
  href?: string;
  stickyLeft: boolean;
}) {
  const meta = metaOf(cell.column);
  const value = cell.getValue();
  // Empty value (08-tables.md "Cell kinds"): a faint dash that reads "None".
  // Display columns (no accessor) always render their own cell.
  const blank = Boolean(cell.column.accessorFn) && (value === null || value === undefined || value === '');
  const kindClass =
    meta.kind === 'number' || meta.align === 'right'
      ? 'text-right tabular-nums'
      : meta.kind === 'ip' || meta.kind === 'id'
        ? 'font-mono text-[12.5px]'
        : '';
  const content = blank ? (
    <span aria-label="None" className="text-fg-faint">
      —
    </span>
  ) : (
    flexRender(cell.column.columnDef.cell, cell.getContext())
  );

  return (
    <td
      style={meta.width ? { width: meta.width, maxWidth: meta.width } : undefined}
      className={`${meta.width ? 'truncate' : 'whitespace-nowrap'} px-3 focus-within:-outline-offset-2 ${kindClass} ${PRIORITY_CELL[meta.priority]} ${stickyLeft ? `${STICKY_LEFT} group-data-[state=selected]:bg-surface-3 pointer-fine:group-hover:bg-surface-2` : ''}`}
    >
      {href ? (
        <Link href={href} prefetch={false} data-row-link className="focus-visible:-outline-offset-2">
          {content}
        </Link>
      ) : (
        content
      )}
    </td>
  );
}
