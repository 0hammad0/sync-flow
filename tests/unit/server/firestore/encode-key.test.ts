import { describe, expect, it } from 'vitest';

import { FOLD_KEY, MAX_KEY_CHARS, UNKNOWN_KEY, decodeKey, encodeKey } from '@/server/firestore/encode-key';

describe('encodeKey', () => {
  it.each([
    '/chat/[code]',
    'news.example.com',
    'PK:PB:Lahore',
    'São Paulo',
    'a*b~c`d',
    '100%',
    '__name__',
    '_other',
    'emoji 🚀',
  ])('round-trips %s with no unsafe characters', (value) => {
    const key = encodeKey(value);
    expect(key).not.toMatch(/[./[\]`*~]/);
    expect(key.startsWith('_')).toBe(false);
    expect(decodeKey(key)).toBe(value);
  });

  it('never produces the fold key', () => {
    expect(encodeKey(FOLD_KEY)).not.toBe(FOLD_KEY);
  });

  it('maps empty and missing values to the unknown key', () => {
    for (const value of [null, undefined, '', '   ']) expect(encodeKey(value)).toBe(UNKNOWN_KEY);
  });

  it('caps long values', () => {
    expect(decodeKey(encodeKey('x'.repeat(5000)))).toHaveLength(MAX_KEY_CHARS);
    expect(Buffer.byteLength(encodeKey('.'.repeat(5000)))).toBeLessThan(1500);
  });
});
