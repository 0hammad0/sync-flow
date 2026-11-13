import { describe, expect, it } from 'vitest';

import type { BreakdownRow, SessionRowDto } from '@/server/analytics/dto';
import { maskIpDto } from '@/server/analytics/session-dto';
import { COUNTRY_COLUMNS, PAGE_COLUMNS, SESSION_COLUMNS, sourceColumns } from '@/server/export/columns';
import {
  CSV_BOM,
  csvCell,
  csvFileName,
  csvLine,
  csvPercent,
  csvSeconds,
  csvTime,
  guardFormula,
  toCsv,
} from '@/server/export/csv';

function session(overrides: Partial<SessionRowDto> = {}): SessionRowDto {
  return {
    id: 'a'.repeat(32),
    startedAt: '2026-11-13T09:05:09.123Z',
    lastSeenAt: '2026-11-13T09:09:21.000Z',
    durationMs: 252_000,
    pageviews: 5,
    engagedMs: 180_400,
    entryPath: '/',
    exitPath: '/chat/[code]',
    country: 'PK',
    region: 'PB',
    city: 'Lahore',
    device: 'mobile',
    browser: 'Safari',
    os: 'iOS',
    referrerHost: 'google.com',
    utmSource: null,
    userId: null,
    sampled: false,
    ip: '39.4.2.17',
    ipMasked: false,
    ipTruncated: false,
    ...overrides,
  };
}

function breakdown(overrides: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    key: 'google.com',
    label: 'google.com',
    other: false,
    visitors: 340,
    sessions: 388,
    pageviews: 900,
    avgEngagedMs: 61_400,
    bounceRate: 0.4105,
    share: 0.26,
    country: null,
    region: null,
    lat: null,
    lon: null,
    ...overrides,
  };
}

/** The data lines of a file (BOM and trailing CRLF dropped). */
function lines(csv: string): string[] {
  return csv.replace(CSV_BOM, '').split('\r\n').slice(0, -1);
}

describe('csv cells', () => {
  it('quotes every field and doubles quotes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(Number.NaN)).toBe('""');
    expect(csvCell(true)).toBe('"true"');
  });

  it('ends lines with CRLF and starts files with a UTF-8 BOM', () => {
    expect(csvLine(['a', 1, null])).toBe('"a","1",""\r\n');
    const file = toCsv([{ header: 'Name', value: (r: { n: string }) => r.n }], [{ n: 'Zoë' }]);
    expect(file.startsWith('\uFEFF"Name"\r\n')).toBe(true);
    expect(file).toBe('\uFEFF"Name"\r\n"Zoë"\r\n');
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])('guards text that starts with %j against formula injection', (lead) => {
    const value = `${lead}HYPERLINK("http://evil.example","x")`;
    expect(guardFormula(value)).toBe(`'${value}`);
    expect(csvCell(value).startsWith(`"'${lead}`)).toBe(true);
  });

  it('leaves safe text and our own numbers alone', () => {
    expect(guardFormula('google.com')).toBe('google.com');
    expect(guardFormula('a=b')).toBe('a=b');
    expect(guardFormula(' =1')).toBe(' =1');
    expect(csvCell(-3)).toBe('"-3"');
  });

  it('guards hostile values that reach a real export (UTM tags come from visitors\' URLs)', () => {
    const csv = toCsv(sourceColumns('utm_campaign'), [breakdown({ key: '=cmd|"/c calc"!A1', label: '=cmd|"/c calc"!A1' })]);
    const [, row] = lines(csv);
    expect(row.startsWith(`"'=cmd|""/c calc""!A1","'=cmd|""/c calc""!A1"`)).toBe(true);
  });

  it('formats times, seconds and rates for spreadsheets', () => {
    expect(csvTime('2026-11-13T09:05:09.123Z')).toBe('2026-11-13T09:05:09Z');
    expect(csvTime(null)).toBeNull();
    expect(csvSeconds(180_400)).toBe(180);
    expect(csvSeconds(null)).toBeNull();
    expect(csvPercent(0.4105)).toBe(41.1);
    expect(csvPercent(null)).toBeNull();
  });

  it('builds a safe file name from the table and range', () => {
    expect(csvFileName(['sessions'], '2026-11-13', '2026-11-13')).toBe('syncflow-sessions-2026-11-13.csv');
    expect(csvFileName(['sources', 'utm-campaign'], '2026-11-07', '2026-11-13')).toBe(
      'syncflow-sources-utm-campaign-2026-11-07_2026-11-13.csv',
    );
    expect(csvFileName(['regions', 'PK', ''], '2026-11-07', '2026-11-13')).toBe('syncflow-regions-pk-2026-11-07_2026-11-13.csv');
    expect(csvFileName(['a"b\r\nc'], '2026-11-13', '2026-11-13')).toBe('syncflow-a-b-c-2026-11-13.csv');
  });
});

describe('session columns and IPs', () => {
  it('writes the masked IP for a role without ip:read, never the full one', () => {
    const rows = [session(), session({ id: 'b'.repeat(32), ip: '2001:db8:85a3:8d3:1319:8a2e:370:7348' })];
    const csv = toCsv(SESSION_COLUMNS, rows.map((r) => maskIpDto(r, false)));
    expect(csv).not.toContain('39.4.2.17');
    expect(csv).not.toContain('8a2e:370:7348');
    expect(csv).toContain('"39.4.2.•••"');
    expect(csv).toContain('"2001:db8:85a3:•••"');
    const header = lines(csv)[0].split(',');
    const ipMasked = header.indexOf('"IP masked"');
    for (const line of lines(csv).slice(1)) expect(line.split(',')[ipMasked]).toBe('"yes"');
  });

  it('writes the full IP for a role with ip:read', () => {
    const csv = toCsv(SESSION_COLUMNS, [maskIpDto(session(), true)]);
    expect(csv).toContain('"39.4.2.17"');
  });

  it('keeps a null IP empty either way', () => {
    const csv = toCsv(SESSION_COLUMNS, [maskIpDto(session({ ip: null }), false)]);
    expect(lines(csv)[1]).not.toContain('•••');
  });

  it('writes one row per session with ISO UTC times', () => {
    const [header, row] = lines(toCsv(SESSION_COLUMNS, [session()]));
    expect(header.split(',')).toHaveLength(SESSION_COLUMNS.length);
    expect(row).toContain('"2026-11-13T09:05:09Z"');
    expect(row).toContain('"252"');
  });
});

describe('column allowlists', () => {
  it('have fixed, unique headers', () => {
    for (const columns of [SESSION_COLUMNS, PAGE_COLUMNS, COUNTRY_COLUMNS, sourceColumns('referrer')]) {
      const headers = columns.map((c) => c.header);
      expect(new Set(headers).size).toBe(headers.length);
    }
  });

  it('never write the folded "_other" key as a code', () => {
    const [, row] = lines(toCsv(COUNTRY_COLUMNS, [breakdown({ key: '_other', label: 'Other', other: true })]));
    expect(row).not.toContain('_other');
    expect(row.startsWith('"Other",""')).toBe(true);
  });
});
