import { describe, expect, it } from 'vitest';
import {
  MAX_CURSOR_DEPTH,
  pageCursors,
  parseCursorStack,
  parseSessionsParams,
  serializeCursorStack,
  toSessionFilter,
} from '@/features/admin/sessions/schemas';

const UID = 'AbCdEfGhIjKlMnOpQrStUvWxYz12';
const IP_READ = { canSeeIp: true };
const NO_IP = { canSeeIp: false };

describe('parseSessionsParams: one filter at a time', () => {
  it('no params: no filter, first page', () => {
    expect(parseSessionsParams({}, IP_READ)).toEqual({ filter: null, q: '', searchProblem: null, ignored: [], cursorStack: [] });
    expect(parseSessionsParams(null, IP_READ).filter).toBeNull();
  });

  it('country and device each work alone', () => {
    expect(parseSessionsParams({ country: 'pk' }, NO_IP).filter).toEqual({ kind: 'country', value: 'PK' });
    expect(parseSessionsParams({ device: 'mobile' }, NO_IP).filter).toEqual({ kind: 'device', value: 'mobile' });
  });

  it('two filters keep the first (q, country, device) and list the rest as ignored', () => {
    const both = parseSessionsParams({ device: 'tablet', country: 'US' }, NO_IP);
    expect(both.filter).toEqual({ kind: 'country', value: 'US' });
    expect(both.ignored).toEqual(['device']);

    const three = parseSessionsParams({ q: UID, country: 'US', device: 'desktop' }, NO_IP);
    expect(three.filter).toEqual({ kind: 'user', value: UID });
    expect(three.ignored).toEqual(['country', 'device']);
  });

  it('bad values are dropped, not errors, and do not count as a filter', () => {
    const bad = parseSessionsParams({ country: 'Pakistan', device: 'phone' }, IP_READ);
    expect(bad.filter).toBeNull();
    expect(bad.ignored).toEqual([]);
    expect(parseSessionsParams({ country: '12' }, IP_READ).filter).toBeNull();
    expect(parseSessionsParams({ device: ['desktop', 'mobile'] }, IP_READ).filter).toEqual({ kind: 'device', value: 'desktop' });
    // A bad first filter does not block a good second one.
    expect(parseSessionsParams({ country: 'xx1', device: 'mobile' }, IP_READ).filter).toEqual({ kind: 'device', value: 'mobile' });
  });

  it('search: a user id becomes the user filter', () => {
    expect(parseSessionsParams({ q: `  ${UID} ` }, NO_IP).filter).toEqual({ kind: 'user', value: UID });
  });

  it('search: a full IP is IP search for ip:read only', () => {
    expect(parseSessionsParams({ q: '203.0.113.7' }, IP_READ).filter).toEqual({ kind: 'ip', value: '203.0.113.7' });
    expect(parseSessionsParams({ q: '2001:DB8::1' }, IP_READ).filter).toEqual({ kind: 'ip', value: '2001:db8::1' });
    const viewer = parseSessionsParams({ q: '203.0.113.7' }, NO_IP);
    expect(viewer.filter).toBeNull();
    expect(viewer.searchProblem).toBe('ip_not_allowed');
  });

  it('search: anything else is not searched', () => {
    for (const q of ['999.1.1.1', '/chat', 'sara@example.com', '203.0.113.0/24']) {
      const p = parseSessionsParams({ q }, IP_READ);
      expect(p.filter).toBeNull();
      expect(p.searchProblem).toBe('invalid');
    }
  });

  it('a bad search does not hide a good filter, but still says why', () => {
    const p = parseSessionsParams({ q: 'not-an-id', country: 'PK' }, IP_READ);
    expect(p.filter).toEqual({ kind: 'country', value: 'PK' });
    expect(p.searchProblem).toBe('invalid');
    expect(p.ignored).toEqual([]);
    // A viewer's IP search falls through the same way (the CSV export agrees).
    expect(parseSessionsParams({ q: '203.0.113.7', device: 'mobile' }, NO_IP).filter).toEqual({ kind: 'device', value: 'mobile' });
  });

  it('a session id (32 hex) is not a user id', () => {
    expect(parseSessionsParams({ q: 'a'.repeat(32) }, IP_READ).searchProblem).toBe('invalid');
  });

  it('IP search has no pages: the cursor is dropped', () => {
    expect(parseSessionsParams({ q: '203.0.113.7', cursor: 'abc' }, IP_READ).cursorStack).toEqual([]);
    expect(parseSessionsParams({ country: 'PK', cursor: 'abc.def' }, IP_READ).cursorStack).toEqual(['abc', 'def']);
  });
});

describe('cursor trail', () => {
  it('parses and rejects bad parts', () => {
    expect(parseCursorStack('')).toEqual([]);
    expect(parseCursorStack('a1_-.b2')).toEqual(['a1_-', 'b2']);
    expect(parseCursorStack('a..b')).toEqual([]);
    expect(parseCursorStack('a.b<script>')).toEqual([]);
  });

  it('keeps only the newest steps when too deep', () => {
    const deep = Array.from({ length: MAX_CURSOR_DEPTH + 5 }, (_, i) => `c${i}`);
    const parsed = parseCursorStack(deep.join('.'));
    expect(parsed).toHaveLength(MAX_CURSOR_DEPTH);
    expect(parsed.at(-1)).toBe(`c${MAX_CURSOR_DEPTH + 4}`);
  });

  it('first page: no Newer, Older starts the trail', () => {
    expect(pageCursors([], 'n1')).toEqual({ cursor: null, prevCursor: null, nextCursor: 'n1' });
  });

  it('second page: Newer is the first page (empty cursor)', () => {
    expect(pageCursors(['n1'], 'n2')).toEqual({ cursor: 'n1', prevCursor: '', nextCursor: 'n1.n2' });
  });

  it('deeper pages: Newer drops the last step; the last page has no Older', () => {
    expect(pageCursors(['n1', 'n2', 'n3'], null)).toEqual({ cursor: 'n3', prevCursor: 'n1.n2', nextCursor: null });
    expect(serializeCursorStack(['a', 'b'])).toBe('a.b');
  });
});

describe('toSessionFilter', () => {
  it('maps to the indexed repository fields; IP is not a range filter', () => {
    expect(toSessionFilter({ kind: 'country', value: 'PK' })).toEqual({ field: 'country', value: 'PK' });
    expect(toSessionFilter({ kind: 'device', value: 'tablet' })).toEqual({ field: 'device', value: 'tablet' });
    expect(toSessionFilter({ kind: 'user', value: UID })).toEqual({ field: 'user_id', value: UID });
    expect(toSessionFilter({ kind: 'ip', value: '203.0.113.7' })).toBeNull();
    expect(toSessionFilter(null)).toBeNull();
  });
});
