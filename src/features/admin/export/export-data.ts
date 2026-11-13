import 'server-only';

import {
  getPageStats,
  listCityStats,
  listCountryStats,
  listRegionStats,
  listSourceStats,
  resolveAnalyticsRange,
  type QueryResult,
  type SourceDim,
} from '@/features/admin/analytics/queries';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import { UNKNOWN_REGION } from '@/features/admin/geography/drill';
import type { BreakdownDto, BreakdownRow, PageRow, SessionRowDto } from '@/server/analytics/dto';
import { maskIpDto, toSessionRow } from '@/server/analytics/session-dto';
import { getEventRepository, getQuota } from '@/server/container-light';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import {
  CITY_COLUMNS,
  COUNTRY_COLUMNS,
  PAGE_COLUMNS,
  REGION_COLUMNS,
  SESSION_COLUMNS,
  sourceColumns,
} from '@/server/export/columns';
import type { CsvColumn } from '@/server/export/csv';
import type { SessionFilter } from '@/server/repositories/interfaces';
import { sessionBounds } from '@/server/services/analytics-service';
import { normaliseIp } from '@/shared/lib/ip';
import type { CountriesExportParams, ExportRequest, ExportSort, PagesExportParams, SessionsExportParams, SourcesExportParams } from './schemas';
import { EXPORT_MAX_ROWS, type ExportTable } from './tables';

// What one export reads and writes. Rollup tables (pages, places, sources)
// use the same cached queries as their screens, so the rows match what the
// admin sees and cost no extra reads when the screen just loaded them.
// Sessions read `a_sessions` page by page (1 read per row), after a
// `count()` that sizes the export and checks today's read budget first.

/** Rows per `listSessions` call (the repository clamps a page to 100). */
const SESSION_BATCH = 100;
/** IP search: exact match, any date, at most 100 (04-sessions.md). */
const IP_SEARCH_LIMIT = 100;
/** "28-char uid → user filter" (04-sessions.md "Search q"). */
const UID_RE = /^[A-Za-z0-9]{28}$/;

type Row = SessionRowDto | PageRow | BreakdownRow;

export type ExportPlan = {
  table: ExportTable;
  range: ResolvedRange;
  /** Rows that match the filters. */
  total: number;
  /** Rows the file will hold: `min(total, 5,000)`. */
  rowCount: number;
  /** For the file name, e.g. `['sources', 'browsers']`. */
  fileParts: string[];
  /** What the audit row records as the filters. */
  filters: Record<string, string | null>;
  /** Sessions: IPs in the file are masked for this role. Null for tables without IPs. */
  ipMasked: boolean | null;
  columns: readonly CsvColumn<Row>[];
  /** The rows, in order, read lazily (sessions) or from memory (rollups). */
  rows: () => AsyncIterable<Row>;
};

export type PlanResult =
  | { state: 'ok'; plan: ExportPlan }
  /** Today's read cap is reached, or the export needs more reads than are left. */
  | { state: 'budget' }
  | { state: 'error'; errorId: string };

export type ExportAccess = { canSeeIp: boolean };

async function* fromArray<T>(rows: readonly T[]): AsyncIterable<T> {
  for (const row of rows) yield row;
}

function sortText(sort: ExportSort): string | null {
  return sort ? `${sort.desc ? '-' : ''}${sort.field}` : null;
}

function rangeFilters(range: ResolvedRange): Record<string, string> {
  return { range: range.kind, from: range.from, to: range.to };
}

/**
 * Sorts by one field; nulls last; the folded `_other` row always last (as on
 * screen). No sort keeps the query's order.
 */
function sortRows<T extends { other: boolean }>(rows: readonly T[], sort: ExportSort): T[] {
  const out = [...rows];
  if (!sort) return out.sort((a, b) => Number(a.other) - Number(b.other));
  const dir = sort.desc ? -1 : 1;
  return out.sort((a, b) => {
    if (a.other !== b.other) return a.other ? 1 : -1;
    const x = (a as Record<string, unknown>)[sort.field];
    const y = (b as Record<string, unknown>)[sort.field];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y)) * dir;
  });
}

function capped<T>(rows: readonly T[]): { total: number; rowCount: number; kept: readonly T[] } {
  return { total: rows.length, rowCount: Math.min(rows.length, EXPORT_MAX_ROWS), kept: rows.slice(0, EXPORT_MAX_ROWS) };
}

/** Rollup queries already map QuotaExceededError to `budget` and log errors. */
function failed<T>(result: QueryResult<T>): PlanResult | null {
  if (result.state === 'budget') return { state: 'budget' };
  if (result.state === 'error') return { state: 'error', errorId: result.errorId };
  return null;
}

// ---------------------------------------------------------------------------
// Sessions

/** Remaining reads today, by the same numbers QuotaGuard decides on. */
async function readsLeft(): Promise<number> {
  const usage = await getQuota().usage();
  if (usage.stoppedUntil !== null) return 0;
  return Math.max(0, usage.caps.reads - usage.used.reads);
}

async function planSessions(range: ResolvedRange, params: SessionsExportParams, access: ExportAccess): Promise<ExportPlan | 'budget'> {
  const reader = getEventRepository();
  const base = {
    table: 'sessions' as const,
    range,
    fileParts: ['sessions'],
    ipMasked: !access.canSeeIp,
    columns: SESSION_COLUMNS as readonly CsvColumn<Row>[],
  };

  // An IP search could confirm a full IP the role may not see, so it needs ip:read.
  const ip = access.canSeeIp && params.q ? normaliseIp(params.q) : null;
  if (ip) {
    if ((await readsLeft()) < IP_SEARCH_LIMIT) return 'budget';
    const found = await reader.findSessionsByIp(ip, IP_SEARCH_LIMIT);
    const rows = found
      .sort((a, b) => (b.started_at?.getTime() ?? 0) - (a.started_at?.getTime() ?? 0))
      .map((s) => maskIpDto(toSessionRow(s), access.canSeeIp));
    return {
      ...base,
      total: rows.length,
      rowCount: rows.length,
      filters: { ip },
      rows: () => fromArray(rows),
    };
  }

  const uid = params.q && UID_RE.test(params.q) ? params.q : null;
  const filter: SessionFilter | null = uid
    ? { field: 'user_id', value: uid }
    : params.country
      ? { field: 'country', value: params.country }
      : params.device
        ? { field: 'device', value: params.device }
        : null;
  const query = { ...sessionBounds(range, Date.now()), filter };

  const total = await reader.countSessions(query);
  const rowCount = Math.min(total, EXPORT_MAX_ROWS);
  // 1 read per row, and at least 1 per page.
  if (Math.max(rowCount, Math.ceil(rowCount / SESSION_BATCH)) > (await readsLeft())) return 'budget';

  async function* rows(): AsyncIterable<Row> {
    let cursor: string | null = null;
    let sent = 0;
    while (sent < rowCount) {
      const page = await reader.listSessions({ ...query, limit: Math.min(SESSION_BATCH, rowCount - sent), cursor });
      for (const doc of page.sessions) {
        if (sent >= rowCount) return;
        sent += 1;
        yield maskIpDto(toSessionRow(doc), access.canSeeIp);
      }
      if (!page.nextCursor || page.sessions.length === 0) return;
      cursor = page.nextCursor;
    }
  }

  return {
    ...base,
    total,
    rowCount,
    filters: {
      ...rangeFilters(range),
      user: uid,
      country: filter?.field === 'country' ? filter.value : null,
      device: filter?.field === 'device' ? filter.value : null,
    },
    rows,
  };
}

// ---------------------------------------------------------------------------
// Pages (05-pages.md): every path, `q` prefix search, entry / exit mode, sort.

const PAGE_DEFAULT_SORT: Record<PagesExportParams['mode'], ExportSort> = {
  all: { field: 'pageviews', desc: true },
  entry: { field: 'entries', desc: true },
  exit: { field: 'exits', desc: true },
};

function matchesPath(row: PageRow, q: string | null): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const path = row.path.toLowerCase();
  return path.startsWith(needle) || path.startsWith(`/${needle}`);
}

async function planPages(range: ResolvedRange, params: PagesExportParams): Promise<PlanResult> {
  const result = await getPageStats(range);
  if (result.state !== 'ok') return failed(result)!;
  const rows = result.data.rows
    .filter((r) => matchesPath(r, params.q))
    .filter((r) => (params.mode === 'entry' ? r.entries > 0 : params.mode === 'exit' ? r.exits > 0 : true));
  const { total, rowCount, kept } = capped(sortRows(rows, params.sort ?? PAGE_DEFAULT_SORT[params.mode]));
  return {
    state: 'ok',
    plan: {
      table: 'pages',
      range,
      total,
      rowCount,
      fileParts: params.mode === 'all' ? ['pages'] : ['pages', params.mode],
      filters: { ...rangeFilters(range), q: params.q, mode: params.mode, sort: sortText(params.sort) },
      ipMasked: null,
      columns: PAGE_COLUMNS as readonly CsvColumn<Row>[],
      rows: () => fromArray(kept),
    },
  };
}

// ---------------------------------------------------------------------------
// Places (07-geography.md): world → country's regions → region's cities.

async function planCountries(range: ResolvedRange, params: CountriesExportParams): Promise<PlanResult> {
  const { country } = params;
  const region = country ? params.region : null;
  const level = region ? 'cities' : country ? 'regions' : 'countries';
  const unknownRegion = region === UNKNOWN_REGION;
  const result: QueryResult<BreakdownDto> = region
    ? await listCityStats(range, country!, unknownRegion ? null : region)
    : country
      ? await listRegionStats(range, country)
      : await listCountryStats(range);
  if (result.state !== 'ok') return failed(result)!;
  // Same rows as the screen: under the unknown region, only cities without one.
  const rows = unknownRegion ? result.data.rows.filter((r) => r.other || r.region === null) : result.data.rows;
  const { total, rowCount, kept } = capped(sortRows(rows, params.sort));
  const columns = level === 'cities' ? CITY_COLUMNS : level === 'regions' ? REGION_COLUMNS : COUNTRY_COLUMNS;
  return {
    state: 'ok',
    plan: {
      table: 'countries',
      range,
      total,
      rowCount,
      fileParts: [level, country ?? '', region ?? ''],
      filters: { ...rangeFilters(range), country, region, sort: sortText(params.sort) },
      ipMasked: null,
      columns: columns as readonly CsvColumn<Row>[],
      rows: () => fromArray(kept),
    },
  };
}

// ---------------------------------------------------------------------------
// Sources (08-sources.md): the current tab (and UTM kind).

function sourceDim(params: SourcesExportParams): SourceDim {
  switch (params.tab) {
    case 'referrers':
      return 'referrer';
    case 'utm':
      return `utm_${params.utm}`;
    case 'devices':
      return 'device';
    case 'browsers':
      return 'browser';
    case 'os':
      return 'os';
  }
}

async function planSources(range: ResolvedRange, params: SourcesExportParams): Promise<PlanResult> {
  const dim = sourceDim(params);
  const result = await listSourceStats(range, dim);
  if (result.state !== 'ok') return failed(result)!;
  const { total, rowCount, kept } = capped(sortRows(result.data.rows, params.sort));
  return {
    state: 'ok',
    plan: {
      table: 'sources',
      range,
      total,
      rowCount,
      fileParts: ['sources', dim.replace('_', '-')],
      filters: { ...rangeFilters(range), tab: params.tab, utm: params.tab === 'utm' ? params.utm : null, sort: sortText(params.sort) },
      ipMasked: null,
      columns: sourceColumns(dim) as readonly CsvColumn<Row>[],
      rows: () => fromArray(kept),
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Sizes an export and checks it can be paid for. Reads only what the count
 * needs (sessions) or the screen's cached rollups (other tables); the session
 * rows are read later, while the file streams.
 */
export async function planExport(request: ExportRequest, access: ExportAccess): Promise<PlanResult> {
  try {
    if (request.table === 'sessions') {
      const range = await resolveAnalyticsRange(request.range, 'sessions');
      const plan = await planSessions(range, request.params, access);
      return plan === 'budget' ? { state: 'budget' } : { state: 'ok', plan };
    }
    const range = await resolveAnalyticsRange(request.range, 'rollups');
    switch (request.table) {
      case 'pages':
        return await planPages(range, request.params);
      case 'countries':
        return await planCountries(range, request.params);
      case 'sources':
        return await planSources(range, request.params);
    }
  } catch (error) {
    if (error instanceof QuotaExceededError) return { state: 'budget' };
    const errorId = crypto.randomUUID();
    console.error(`[admin] export: ${request.table} plan failed ${errorId}`, errorKind(error));
    return { state: 'error', errorId };
  }
}

/** Name and code only: a Firestore message can hold a doc path or an IP. */
export function errorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number' ? `${name} ${code}` : name;
}
