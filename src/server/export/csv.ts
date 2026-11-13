// CSV formatting for admin exports (08-tables.md "CSV export"). Pure:
// UTF-8 with BOM (Excel), comma separator, every field quoted, `"` doubled,
// CRLF line ends, and a formula-injection guard on text cells.

/** Excel reads the file as UTF-8 only with this mark first. */
export const CSV_BOM = '\uFEFF';
export const CSV_EOL = '\r\n';

export type CsvValue = string | number | boolean | null | undefined;

/** One output column: a fixed header and how to read the cell from a row. */
export type CsvColumn<T> = { header: string; value: (row: T) => CsvValue };

/**
 * Cells a spreadsheet may run as a formula (OWASP "CSV injection"): a leading
 * `=`, `+`, `-`, `@`, tab or carriage return. Referrer hosts and UTM values
 * come from visitors' URLs, so any text cell can carry one.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Text with a `'` in front when a spreadsheet would read it as a formula. */
export function guardFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Plain text of a value. Numbers are ours (counts, seconds), so only text is guarded. */
function cellText(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return guardFormula(value);
}

/** One quoted field. */
export function csvCell(value: CsvValue): string {
  return `"${cellText(value).replace(/"/g, '""')}"`;
}

/** One line, CRLF included. */
export function csvLine(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(',') + CSV_EOL;
}

export function csvHeaderLine<T>(columns: readonly CsvColumn<T>[]): string {
  return csvLine(columns.map((c) => c.header));
}

export function csvRowLine<T>(columns: readonly CsvColumn<T>[], row: T): string {
  return csvLine(columns.map((c) => c.value(row)));
}

/** A whole file in memory: BOM, header, rows. Tests and small tables; the route streams. */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: Iterable<T>): string {
  let out = CSV_BOM + csvHeaderLine(columns);
  for (const row of rows) out += csvRowLine(columns, row);
  return out;
}

/** ISO 8601 UTC without milliseconds (`2026-11-13T09:05:09Z`, 11-copy.md). */
export function csvTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.replace(/\.\d{3}Z$/, 'Z');
}

/** Milliseconds as whole seconds. */
export function csvSeconds(ms: number | null | undefined): number | null {
  return ms === null || ms === undefined || !Number.isFinite(ms) ? null : Math.round(ms / 1000);
}

/** A 0..1 fraction as a percentage with one decimal (`0.4105` → `41.1`). */
export function csvPercent(fraction: number | null | undefined): number | null {
  return fraction === null || fraction === undefined || !Number.isFinite(fraction) ? null : Math.round(fraction * 1000) / 10;
}

/** A 0..100 value with one decimal. */
export function csvOneDecimal(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}

/**
 * `syncflow-sessions-2026-11-07_2026-11-13.csv` (one day: `…-2026-11-13.csv`).
 * Only `[a-z0-9_-]` survives, so the Content-Disposition header stays safe.
 */
export function csvFileName(parts: readonly string[], from: string, to: string): string {
  const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const span = from === to ? from : `${from}_${to}`;
  return `${['syncflow', ...parts, span].map(safe).filter(Boolean).join('-')}.csv`;
}
