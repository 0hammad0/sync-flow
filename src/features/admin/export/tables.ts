// The CSV export tables (08-tables.md "CSV export"). Client-safe: the button
// imports it, and the route uses it as the table allowlist.

export const EXPORT_TABLES = ['sessions', 'pages', 'countries', 'sources'] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

/** Rows per export (05-performance-budget.md). */
export const EXPORT_MAX_ROWS = 5000;

export function isExportTable(value: unknown): value is ExportTable {
  return typeof value === 'string' && (EXPORT_TABLES as readonly string[]).includes(value);
}

/** Plural noun for dialog copy: "Export 1,902 sessions?". */
export const EXPORT_NOUNS: Record<ExportTable, string> = {
  sessions: 'sessions',
  pages: 'pages',
  countries: 'places',
  sources: 'sources',
};

/** Params the export never takes from the screen URL: paging and view state. */
const DROPPED_PARAMS = ['cursor', 'cols', 'view', 'path', 'host', 'preview'];

/** `/api/admin/export/{table}?{screen params}`, without paging and panel state. */
export function exportHref(table: ExportTable, search: string | URLSearchParams | null | undefined, extra?: Record<string, string>): string {
  const params = new URLSearchParams(search ?? undefined);
  for (const key of DROPPED_PARAMS) params.delete(key);
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  const query = params.toString();
  return `/api/admin/export/${table}${query ? `?${query}` : ''}`;
}
