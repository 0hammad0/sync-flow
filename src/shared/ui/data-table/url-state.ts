// URL state shared by the client table and the server page that reads the
// same params. Imports `nuqs/server` (no 'use client'), so a Server Component
// can call `createLoader(createTableParsers(...))` on its searchParams.
import { parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server';
import { DENSITIES } from './types';

export type SortConfig = {
  /** Column ids the server has an index for. Anything else in `?sort=` falls back to the default. */
  allowed: readonly string[];
  /** Table default, e.g. `-started_at`. Not written to the URL. */
  default: string;
};

/** `?cursor=` value that means "the first page" (the param is removed). */
export const FIRST_PAGE_CURSOR = '';

/** `sort`, `q`, `cols`, `density`, `cursor` (08-tables.md "URL state"). Filters are per table. */
export function createTableParsers(sort: SortConfig) {
  const values = [...sort.allowed, ...sort.allowed.map((id) => `-${id}`)];
  return {
    sort: parseAsStringLiteral(values).withDefault(sort.default),
    q: parseAsString.withDefault(''),
    cols: parseAsArrayOf(parseAsString).withDefault([]),
    density: parseAsStringLiteral(DENSITIES),
    cursor: parseAsString,
  };
}

/** `-started_at` → `{ id: 'started_at', desc: true }`. */
export function parseSort(value: string): { id: string; desc: boolean } {
  return value.startsWith('-') ? { id: value.slice(1), desc: true } : { id: value, desc: false };
}

/**
 * Header click cycle (08-tables.md "Header and sorting"): first click sorts in
 * the column's first direction (`defaultDesc` → desc), the second flips it,
 * the third returns to the table default. One sort key only.
 */
export function nextSort(current: string, columnId: string, defaultDesc: boolean, tableDefault: string): string {
  const first = defaultDesc ? `-${columnId}` : columnId;
  const second = defaultDesc ? columnId : `-${columnId}`;
  if (current === first) return second;
  if (current === second) return tableDefault === second ? first : tableDefault;
  return first;
}
