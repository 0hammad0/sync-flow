import { describe, expect, it } from 'vitest';
import { detectQuery, needsServer } from '@/features/admin/shell/search-detect';

describe('detectQuery', () => {
  it.each([
    ['203.0.113.7', { kind: 'ip', ip: '203.0.113.7' }],
    [' 2001:db8::1 ', { kind: 'ip', ip: '2001:db8::1' }],
    ['39.4.2', { kind: 'partial-ip', family: 4 }],
    ['39.4.', { kind: 'partial-ip', family: 4 }],
    ['2001:db8', { kind: 'partial-ip', family: 6 }],
    ['Ada@Example.com', { kind: 'email', email: 'ada@example.com' }],
    ['abcdEFGHijklMNOPqrstUVWXyz12', { kind: 'uid', uid: 'abcdEFGHijklMNOPqrstUVWXyz12' }],
    ['ab7kq2mz', { kind: 'room', code: 'AB7KQ2MZ' }],
    ['0123456789ABCDEF0123456789abcdef', { kind: 'hex32', value: '0123456789abcdef0123456789abcdef' }],
    ['a1b2c3-2611161230', { kind: 'block-ref', ref: 'A1B2C3-2611161230' }],
  ])('%s', (q, shape) => {
    expect(detectQuery(q)).toEqual(shape);
  });

  it('anything else is client-only text', () => {
    for (const q of ['se', 'sessions', 'not an @ email', 'x', 'AB7KQ2MI' /* I is not in the room alphabet */]) {
      expect(detectQuery(q)).toEqual({ kind: 'text' });
    }
    expect(detectQuery('a'.repeat(101))).toEqual({ kind: 'text' });
  });

  it('only lookups go to the server: text and partial IPs never do', () => {
    expect(needsServer(detectQuery('sessions'))).toBe(false);
    expect(needsServer(detectQuery('39.4.2'))).toBe(false);
    expect(needsServer(detectQuery('203.0.113.7'))).toBe(true);
  });
});
