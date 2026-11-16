import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CspReportLog, parseCspReports, stripUrl, type CspViolation } from '@/server/security/csp-report';

const legacy = {
  'csp-report': {
    'document-uri': 'https://sync.test/admin/users?q=someone@example.com',
    'violated-directive': 'script-src-elem',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example/x.js?token=abc',
    'source-file': 'https://sync.test/_next/static/chunks/a.js?v=1',
    'line-number': 12,
    'script-sample': 'alert(document.cookie)',
    disposition: 'report',
  },
};

const reportingApi = [
  {
    type: 'csp-violation',
    url: 'https://sync.test/admin',
    body: {
      documentURL: 'https://sync.test/admin',
      effectiveDirective: 'connect-src',
      blockedURL: 'https://firestore.googleapis.com/v1/x',
      disposition: 'report',
      sample: 'secret',
    },
  },
  { type: 'deprecation', body: { documentURL: 'https://sync.test/admin' } },
];

describe('parseCspReports', () => {
  it('reads report-uri bodies and drops query strings and samples', () => {
    expect(parseCspReports(legacy)).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'https://evil.example/x.js',
        page: '/admin/users',
        source: 'https://sync.test/_next/static/chunks/a.js',
        line: 12,
        disposition: 'report',
      },
    ]);
    expect(JSON.stringify(parseCspReports(legacy))).not.toMatch(/example\.com|token|cookie/);
  });

  it('reads Reporting API batches, csp-violation only', () => {
    expect(parseCspReports(reportingApi)).toEqual([
      {
        directive: 'connect-src',
        blocked: 'https://firestore.googleapis.com/v1/x',
        page: '/admin',
        source: null,
        line: null,
        disposition: 'report',
      },
    ]);
  });

  it('drops reports from non-admin pages and junk', () => {
    const publicPage = { 'csp-report': { ...legacy['csp-report'], 'document-uri': 'https://sync.test/share/abc' } };
    expect(parseCspReports(publicPage)).toEqual([]);
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports('x')).toEqual([]);
    expect(parseCspReports({ 'csp-report': 'x' })).toEqual([]);
    expect(parseCspReports([{ type: 'csp-violation' }])).toEqual([]);
  });

  it('caps a batch at 20', () => {
    expect(parseCspReports(Array.from({ length: 100 }, () => reportingApi[0]))).toHaveLength(20);
  });
});

describe('stripUrl', () => {
  it.each([
    ['inline', 'inline'],
    ['eval', 'eval'],
    ['data:image/png;base64,AAAA', 'data'],
    ['https://a.test/p?q=1#h', 'https://a.test/p'],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(stripUrl(input)).toBe(expected);
  });
});

describe('CspReportLog', () => {
  const v = (blocked: string): CspViolation => ({
    directive: 'script-src-elem',
    blocked,
    page: '/admin',
    source: null,
    line: null,
    disposition: 'report',
  });

  it('logs each distinct violation once per window', () => {
    const lines: string[] = [];
    const log = new CspReportLog((l) => lines.push(l), 60_000, 50);
    expect(log.record([v('inline'), v('inline')], 0)).toBe(1);
    expect(log.record([v('inline')], 30_000)).toBe(0);
    expect(log.record([v('eval')], 30_000)).toBe(1);
    expect(log.record([v('inline')], 61_000)).toBe(1);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`[csp-report] ${JSON.stringify(v('inline'))}`);
  });

  it('caps lines per window', () => {
    const lines: string[] = [];
    const log = new CspReportLog((l) => lines.push(l), 60_000, 3);
    log.record(Array.from({ length: 10 }, (_, i) => v(`https://h${i}.test/`)), 0);
    expect(lines).toHaveLength(3);
    log.record([v('https://later.test/')], 60_000);
    expect(lines).toHaveLength(4);
  });
});

describe('POST /api/csp-report', () => {
  afterEach(() => vi.restoreAllMocks());

  function post(body: string, ip: string) {
    return new NextRequest('https://sync.test/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report', 'x-forwarded-for': ip },
      body,
    });
  }

  it('answers 204 always and logs only (one line per distinct violation)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await import('@/app/api/csp-report/route');
    expect((await POST(post(JSON.stringify(legacy), '203.0.113.1'))).status).toBe(204);
    expect((await POST(post(JSON.stringify(legacy), '203.0.113.1'))).status).toBe(204);
    expect((await POST(post('not json', '203.0.113.1'))).status).toBe(204);
    expect((await POST(post('x'.repeat(20_000), '203.0.113.1'))).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[csp-report\] \{"directive":"script-src-elem"/);
  });

  it('rate-limits per IP (20 a minute)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await import('@/app/api/csp-report/route');
    for (let i = 0; i < 25; i++) {
      const body = { 'csp-report': { ...legacy['csp-report'], 'blocked-uri': `https://h${i}.test/` } };
      expect((await POST(post(JSON.stringify(body), '203.0.113.9'))).status).toBe(204);
    }
    expect(warn).toHaveBeenCalledTimes(20);
  });
});
