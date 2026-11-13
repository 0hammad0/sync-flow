import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRange, type RangeParams } from '@/features/admin/analytics/range';
import type { BreakdownDto, BreakdownRow, PageRow, PageStatsDto, RangeMeta } from '@/server/analytics/dto';
import { emptySession, type SessionDoc } from '@/server/analytics/model';
import type { AdminContext, AdminRole } from '@/server/auth/types';
import { ForbiddenError, UnauthorizedError } from '@/server/errors';
import { PAGE_COLUMNS, SESSION_COLUMNS } from '@/server/export/columns';
import { AuditService } from '@/server/services/audit-service';
import { MemoryAuditRepository } from '../../support/memory-audit-repository';
import { MemoryEventRepository } from '../../support/memory-event-repository';

// GET /api/admin/export/[table] end to end over in-memory stores:
// block check → same-origin → requireAdmin('export:csv') → table allowlist →
// zod params → count + read budget → audit `export.csv` → streamed CSV.
// Rollup queries are stubbed (their maths has its own tests); sessions go
// through the real EventReader contract (MemoryEventRepository).

const TODAY = '2026-11-13';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  assertNotBlocked: vi.fn(),
  container: null as unknown,
  repo: null as unknown,
  usedReads: 0,
  getPageStats: vi.fn(),
  listCountryStats: vi.fn(),
  listRegionStats: vi.fn(),
  listCityStats: vi.fn(),
  listSourceStats: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}));
vi.mock('@/server/blocklist/assert-not-blocked', () => ({
  assertNotBlocked: mocks.assertNotBlocked,
  blockedApiResponse: (hit: { ref: string }) =>
    Response.json({ success: false, error: 'blocked', ref: hit.ref }, { status: 403 }),
}));
vi.mock('@/server/blocklist/request', () => ({
  clientIp: (h: Headers) => h.get('x-forwarded-for'),
}));
vi.mock('@/server/auth/require-admin', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/auth/require-admin')>();
  return {
    ...real,
    requireAdmin: mocks.requireAdmin,
    requireAdminForRoute: (permission: Parameters<typeof real.requireAdminForRoute>[0]) =>
      real.requireAdminForRoute(permission, mocks.requireAdmin),
  };
});
vi.mock('@/server/container', () => ({ getContainer: () => mocks.container }));
vi.mock('@/server/container-light', () => ({
  getEventRepository: () => mocks.repo,
  getQuota: () => ({
    usage: async () => ({
      day: TODAY,
      used: { reads: mocks.usedReads, writes: 0, deletes: 0 },
      caps: { reads: 10_000, writes: 5_000, deletes: 5_000 },
      stoppedUntil: null,
    }),
    flush: async () => {},
  }),
}));
vi.mock('@/features/admin/analytics/queries', () => ({
  resolveAnalyticsRange: async (params: RangeParams, scope: 'rollups' | 'sessions' = 'rollups') =>
    resolveRange(params, { today: TODAY, retentionDays: scope === 'sessions' ? 90 : null }),
  getPageStats: mocks.getPageStats,
  listCountryStats: mocks.listCountryStats,
  listRegionStats: mocks.listRegionStats,
  listCityStats: mocks.listCityStats,
  listSourceStats: mocks.listSourceStats,
}));

const { GET } = await import('@/app/api/admin/export/[table]/route');

// ---------------------------------------------------------------------------
// Fixtures

const ctxOf = (role: AdminRole): AdminContext => ({ uid: `${role}1`, email: `${role}@example.com`, role, authTime: 0 });
const UID = 'U'.repeat(28);

let seq = 0;
function session(start: string, over: Partial<SessionDoc> = {}): SessionDoc {
  seq += 1;
  const s = emptySession(seq.toString(16).padStart(32, '0'), new Date(Date.parse(start) + 60_000));
  return Object.assign(s, {
    started_at: new Date(start),
    ip: `203.0.113.${seq % 250}`,
    ip_hash: 'SECRET-HASH',
    device_hash: 'SECRET-DEVICE',
    country: 'PK',
    device: 'mobile',
    entry_path: '/',
    exit_path: '/',
    pageviews: 1,
    ...over,
  });
}

const META: RangeMeta = { from: '2026-11-07', to: TODAY, granularity: 'day', sampled: false, sampledDays: [], fallbackDays: [] };

function pageRow(path: string, over: Partial<PageRow> = {}): PageRow {
  return {
    path,
    label: path,
    other: false,
    pageviews: 10,
    visitors: 5,
    sessions: 5,
    entries: 0,
    exits: 0,
    avgEngagedMs: 1000,
    bounceRate: 0.5,
    exitRate: 0.1,
    avgScroll: 50,
    share: 0.1,
    ...over,
  };
}

function breakdownRow(key: string, over: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    key,
    label: key,
    other: false,
    visitors: 1,
    sessions: 1,
    pageviews: 1,
    avgEngagedMs: null,
    bounceRate: null,
    share: 1,
    country: null,
    region: null,
    lat: null,
    lon: null,
    ...over,
  };
}

const breakdown = (rows: BreakdownRow[]): { state: 'ok'; data: BreakdownDto } => ({
  state: 'ok',
  data: { dim: 'country', rows, totalSessions: rows.length, totalRows: rows.length, meta: META },
});

let repo: MemoryEventRepository;
let auditRepo: MemoryAuditRepository;

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  mocks.usedReads = 0;
  repo = new MemoryEventRepository();
  mocks.repo = repo;
  auditRepo = new MemoryAuditRepository();
  mocks.container = { audit: new AuditService(auditRepo) };
  mocks.assertNotBlocked.mockResolvedValue(null);
  mocks.requireAdmin.mockResolvedValue(ctxOf('moderator'));
  for (const s of [
    session('2026-11-12T09:05:09.000Z', { country: 'PK', device: 'mobile', ip: '39.4.2.17' }),
    session('2026-11-12T10:00:00.000Z', { country: 'US', device: 'desktop', user_id: UID }),
    session('2026-11-11T08:00:00.000Z', { country: 'PK', device: 'desktop' }),
    session('2026-10-01T08:00:00.000Z', { country: 'PK' }), // outside 7d
  ]) {
    repo.sessions.set(s.id, s);
  }
});

function call(path: string, headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) {
  const url = new URL(path, 'http://localhost');
  const table = url.pathname.split('/').at(-1) ?? '';
  return GET(new NextRequest(url, { headers: { 'x-forwarded-for': '198.51.100.4', 'user-agent': 'test', ...headers } }), {
    params: Promise.resolve({ table: decodeURIComponent(table) }),
  });
}

/** The body with its BOM kept (Response.text() drops a leading BOM). */
async function rawText(res: Response): Promise<string> {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
}

async function csvLines(res: Response): Promise<string[]> {
  const text = await rawText(res);
  expect(text.charCodeAt(0)).toBe(0xfeff);
  return text.slice(1).split('\r\n').slice(0, -1);
}

const headerOf = (columns: readonly { header: string }[]) => columns.map((c) => `"${c.header}"`).join(',');

async function auditRows() {
  return (await auditRepo.list({ limit: 100 })).entries;
}

// ---------------------------------------------------------------------------

describe('/api/admin/export auth', () => {
  it('answers 401 to a signed-out caller and exports nothing', async () => {
    mocks.requireAdmin.mockRejectedValue(new UnauthorizedError('no_session'));
    const res = await call('/api/admin/export/sessions?range=7d');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(repo.reads).toBe(0);
    expect(await auditRows()).toEqual([]);
  });

  it('answers 403 to a role without export:csv (viewer)', async () => {
    mocks.requireAdmin.mockRejectedValue(new ForbiddenError({ permission: 'export:csv' }));
    const res = await call('/api/admin/export/sessions?range=7d');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden' });
    expect(mocks.requireAdmin).toHaveBeenCalledWith('export:csv');
    expect(repo.reads).toBe(0);
  });

  it('stops a blocked admin before the auth check', async () => {
    mocks.assertNotBlocked.mockResolvedValue({ ref: 'REF123' });
    const res = await call('/api/admin/export/sessions');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'blocked', ref: 'REF123' });
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it('refuses a cross-site request before the auth check', async () => {
    const res = await call('/api/admin/export/sessions', { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'cross_site' });
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it('allows a typed URL (sec-fetch-site: none) and old clients without the header', async () => {
    expect((await call('/api/admin/export/sessions', { 'sec-fetch-site': 'none' })).status).toBe(200);
    expect((await call('/api/admin/export/sessions', {})).status).toBe(200);
  });

  it.each(['users', 'a_sessions', 'audit', '..', 'sessions.csv'])('has no export for table %j', async (table) => {
    const res = await call(`/api/admin/export/${encodeURIComponent(table)}`);
    expect(res.status).toBe(404);
    expect(repo.reads).toBe(0);
    expect(await auditRows()).toEqual([]);
  });
});

describe('sessions export', () => {
  it('streams the allowlisted columns, newest first, for the range only', async () => {
    const res = await call('/api/admin/export/sessions?range=7d');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="syncflow-sessions-2026-11-07_2026-11-13.csv"');
    const lines = await csvLines(res);
    expect(lines[0]).toBe(headerOf(SESSION_COLUMNS));
    expect(lines).toHaveLength(4);
    expect(lines[1].startsWith('"2026-11-12T10:00:00Z"')).toBe(true);
    expect(lines[3].startsWith('"2026-11-11T08:00:00Z"')).toBe(true);
  });

  it('ignores params that try to pick fields or collections', async () => {
    const res = await call('/api/admin/export/sessions?range=7d&fields=ip_hash,device_hash&collection=users&cols=ip');
    const text = await rawText(res);
    expect(text.slice(1).split('\r\n')[0]).toBe(headerOf(SESSION_COLUMNS));
    expect(text).not.toContain('SECRET-HASH');
    expect(text).not.toContain('SECRET-DEVICE');
  });

  it('gives a moderator (ip:read) full IPs', async () => {
    const text = await (await call('/api/admin/export/sessions?range=7d')).text();
    expect(text).toContain('"39.4.2.17"');
  });

  it('never unmasks IPs for a role without ip:read', async () => {
    // No shipped role has export:csv without ip:read; this guards the mapping if one ever does.
    mocks.requireAdmin.mockResolvedValue(ctxOf('viewer'));
    const text = await (await call('/api/admin/export/sessions?range=7d')).text();
    expect(text).not.toContain('39.4.2.17');
    expect(text).toContain('"39.4.2.•••","yes"');
    expect(text).not.toMatch(/203\.0\.113\.\d+"/);
  });

  it('ignores an IP search for a role without ip:read', async () => {
    mocks.requireAdmin.mockResolvedValue(ctxOf('viewer'));
    const lines = await csvLines(await call('/api/admin/export/sessions?range=7d&q=39.4.2.17'));
    expect(lines).toHaveLength(4);
  });

  it('applies the screen filters: country, device, user id, IP search', async () => {
    expect(await csvLines(await call('/api/admin/export/sessions?range=7d&country=pk'))).toHaveLength(3);
    expect(await csvLines(await call('/api/admin/export/sessions?range=7d&device=desktop'))).toHaveLength(3);
    const byUser = await csvLines(await call(`/api/admin/export/sessions?range=7d&q=${UID}`));
    expect(byUser).toHaveLength(2);
    expect(byUser[1]).toContain(`"${UID}"`);
    const byIp = await csvLines(await call('/api/admin/export/sessions?q=39.4.2.17'));
    expect(byIp).toHaveLength(2);
  });

  it('falls back silently on bad filter values', async () => {
    const lines = await csvLines(await call('/api/admin/export/sessions?range=7d&country=Pakistan&device=fridge'));
    expect(lines).toHaveLength(4);
  });

  it('writes one export.csv audit row with table, filters and row count', async () => {
    mocks.requireAdmin.mockResolvedValue(ctxOf('owner'));
    await (await call('/api/admin/export/sessions?range=7d&country=PK')).text();
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'export.csv',
      actorUid: 'owner1',
      targetType: 'table',
      targetId: 'sessions',
      after: {
        table: 'sessions',
        rows: 2,
        total: 2,
        ipMasked: false,
        filters: { range: '7d', from: '2026-11-07', to: TODAY, country: 'PK', device: null, user: null },
      },
    });
  });

  it('exports nothing when the audit row cannot be written', async () => {
    mocks.container = { audit: { record: vi.fn().mockRejectedValue(new Error('down')) } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('/api/admin/export/sessions?range=7d');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('refuses with the budget message when the rows would cross the read cap', async () => {
    mocks.usedReads = 9_999;
    const res = await call('/api/admin/export/sessions?range=7d');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'budget',
      message: "Today's read budget can't cover this export. Try a shorter range or tomorrow.",
    });
    expect(await auditRows()).toEqual([]);
  });

  it('caps the file at 5,000 rows and says how many matched', async () => {
    for (let i = 0; i < 5_003; i += 1) {
      const s = session(new Date(Date.parse('2026-11-12T00:00:00.000Z') + i * 1000).toISOString());
      repo.sessions.set(s.id, s);
    }
    const preview = await (await call('/api/admin/export/sessions?range=7d&preview=1')).json();
    expect(preview).toMatchObject({ ok: true, rows: 5_000, total: 5_006, limit: 5_000, from: '2026-11-07', to: TODAY });

    const res = await call('/api/admin/export/sessions?range=7d');
    expect(res.headers.get('x-export-total')).toBe('5006');
    expect(await csvLines(res)).toHaveLength(5_001);
    expect((await auditRows())[0].after).toMatchObject({ rows: 5_000, total: 5_006 });
  });

  it('preview counts without reading rows or writing an audit row', async () => {
    const res = await call('/api/admin/export/sessions?range=7d&preview=1');
    expect(await res.json()).toMatchObject({ ok: true, table: 'sessions', rows: 3, total: 3 });
    expect(repo.reads).toBe(1);
    expect(await auditRows()).toEqual([]);
  });
});

describe('rollup exports', () => {
  const stats: PageStatsDto = {
    rows: [
      pageRow('/', { pageviews: 30, entries: 9, exits: 2 }),
      pageRow('/chat/[code]', { pageviews: 20, entries: 0, exits: 8 }),
      pageRow('/share/[token]', { pageviews: 40, entries: 3, exits: 0 }),
      pageRow('_other', { label: 'Other', other: true, pageviews: 99 }),
    ],
    totalPageviews: 189,
    meta: META,
  };

  it('pages: allowlisted columns, search, mode and sort like the screen', async () => {
    mocks.getPageStats.mockResolvedValue({ state: 'ok', data: stats });
    const all = await csvLines(await call('/api/admin/export/pages?range=7d'));
    expect(all[0]).toBe(headerOf(PAGE_COLUMNS));
    expect(all.slice(1).map((l) => l.split(',')[0])).toEqual(['"/share/[token]"', '"/"', '"/chat/[code]"', '"Other"']);

    const entry = await csvLines(await call('/api/admin/export/pages?range=7d&mode=entry'));
    expect(entry.slice(1).map((l) => l.split(',')[0])).toEqual(['"/"', '"/share/[token]"']);

    const search = await csvLines(await call('/api/admin/export/pages?range=7d&q=chat&sort=path'));
    expect(search.slice(1).map((l) => l.split(',')[0])).toEqual(['"/chat/[code]"']);

    const rows = await auditRows();
    expect(rows.map((r) => r.after)).toContainEqual(
      expect.objectContaining({ table: 'pages', rows: 1, filters: expect.objectContaining({ q: 'chat', mode: 'all', sort: 'path' }) }),
    );
  });

  it('places: drills to regions and cities like the map', async () => {
    mocks.listCountryStats.mockResolvedValue(breakdown([breakdownRow('PK', { label: 'Pakistan' })]));
    mocks.listRegionStats.mockResolvedValue(breakdown([breakdownRow('PB', { label: 'Punjab', country: 'PK' })]));
    mocks.listCityStats.mockResolvedValue(breakdown([breakdownRow('Lahore', { country: 'PK', region: 'PB' })]));

    const world = await call('/api/admin/export/countries?range=7d');
    expect((await csvLines(world))[1]).toContain('"Pakistan","PK"');

    const regions = await call('/api/admin/export/countries?range=7d&country=PK');
    expect(regions.headers.get('content-disposition')).toContain('syncflow-regions-pk-');
    expect(mocks.listRegionStats).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-11-07' }), 'PK');

    await call('/api/admin/export/countries?range=7d&country=PK&region=PB');
    expect(mocks.listCityStats).toHaveBeenCalledWith(expect.anything(), 'PK', 'PB');

    // A region without a country, or a bad country, stays at world level.
    await call('/api/admin/export/countries?range=7d&region=PB');
    await call('/api/admin/export/countries?range=7d&country=Pakistan');
    expect(mocks.listCountryStats).toHaveBeenCalledTimes(3);
  });

  it('places: matches the Geography screen for the unknown region and its sort ids', async () => {
    mocks.listCityStats.mockResolvedValue(
      breakdown([
        breakdownRow('Lahore', { country: 'PK', region: 'PB', visitors: 9 }),
        breakdownRow('Chitral', { country: 'PK', region: null, visitors: 2 }),
        breakdownRow('Quetta', { country: 'PK', region: null, visitors: 5 }),
      ]),
    );

    // `_unknown` = the country's cities without a region, as on the screen.
    const unknown = await call('/api/admin/export/countries?range=7d&country=PK&region=_unknown');
    expect(mocks.listCityStats).toHaveBeenLastCalledWith(expect.anything(), 'PK', null);
    const lines = (await csvLines(unknown)).join('\n');
    expect(lines).toContain('Chitral');
    expect(lines).not.toContain('Lahore');

    // Geography's `place` column id sorts by label.
    const byPlace = await csvLines(await call('/api/admin/export/countries?range=7d&country=PK&region=_unknown&sort=place'));
    expect(byPlace[1]).toContain('Chitral');
    expect(byPlace[2]).toContain('Quetta');
  });

  it('sources: exports the current tab and guards visitor-made values', async () => {
    mocks.listSourceStats.mockResolvedValue(
      breakdown([breakdownRow('=HYPERLINK("http://evil.example")', { label: '=HYPERLINK("http://evil.example")' })]),
    );
    const res = await call('/api/admin/export/sources?range=7d&tab=utm&utm=campaign');
    expect(mocks.listSourceStats).toHaveBeenCalledWith(expect.anything(), 'utm_campaign');
    const lines = await csvLines(res);
    expect(lines[0].startsWith('"UTM campaign","Code"')).toBe(true);
    expect(lines[1].startsWith(`"'=HYPERLINK(""http://evil.example"")"`)).toBe(true);

    await call('/api/admin/export/sources?range=7d&tab=nope');
    expect(mocks.listSourceStats).toHaveBeenLastCalledWith(expect.anything(), 'referrer');
  });

  it('maps a used-up read budget to the budget message', async () => {
    mocks.getPageStats.mockResolvedValue({ state: 'budget' });
    const res = await call('/api/admin/export/pages?range=7d');
    expect(res.status).toBe(429);
    expect(await auditRows()).toEqual([]);
  });
});
