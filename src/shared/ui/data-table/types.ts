import {
  columnVisibilityFeature,
  createColumnHelper,
  metaHelper,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table';

/**
 * Per-column settings (08-tables.md "Column definition"). Lives in the
 * column's `meta`, typed through the feature registry (TanStack v9 scoped
 * meta), so no global declaration merging.
 */
export type AdminColumnMeta = {
  /** 1 always shown · 2 when the table container is ≥ 640 px · 3 when ≥ 960 px. */
  priority: 1 | 2 | 3;
  /** Plain-text column name for the column menu and screen readers. Default: the header if it is a string. */
  label?: string;
  /** Numbers right. Default left. */
  align?: 'left' | 'right';
  kind?: 'text' | 'number' | 'time' | 'ip' | 'id' | 'country' | 'badge';
  /** Only when the server has an index for it. The column id must be in the table's sort allowlist. */
  sortable?: boolean;
  /** First click sorts descending (numbers, times). */
  defaultDesc?: boolean;
  /** Fixed width in px. Text columns flex. */
  width?: number;
  /** Slot in MobileCardList. Default `meta`. */
  card?: 'title' | 'subtitle' | 'meta' | 'trailing' | 'hidden';
};

/**
 * Server mode: sorting and paging happen in Firestore, so only state
 * features are registered (no sorted/paginated row models). Rows arrive
 * already sorted and paged.
 */
export const adminTableFeatures = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  columnMeta: metaHelper<AdminColumnMeta>(),
});

export type AdminTableFeatures = typeof adminTableFeatures;

// The helper's own return type uses `any` for heterogeneous accessor values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminColumnDef<Row extends RowData> = ColumnDef<AdminTableFeatures, Row, any>;

/** `const col = createAdminColumnHelper<Session>()` then `col.columns([...])`. */
export function createAdminColumnHelper<Row extends RowData>() {
  return createColumnHelper<AdminTableFeatures, Row>();
}

/** Fixed page size: no "Rows" select (08-tables.md "Pagination"). */
export const PAGE_SIZE = 25;

/** Table container width below which list screens show cards (04-responsive.md "Tables on mobile"). */
export const CARD_BREAKPOINT = 640;

export const DENSITIES = ['compact', 'default', 'comfortable'] as const;
export type Density = (typeof DENSITIES)[number];

/** Cookie that holds the default density (path /admin, 1 year). `?density=` overrides it. */
export const DENSITY_COOKIE = 'sf_admin_density';

/** Bulk server actions process at most this many items per call. */
export const BULK_CAP = 1000;

/** What a bulk action receives: row ids, or "every row matching the current filters". */
export type BulkSelection = { allMatching: false; ids: string[] } | { allMatching: true; total: number };
