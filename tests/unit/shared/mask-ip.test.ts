import { describe, expect, it } from 'vitest';

import { normaliseCidr, normaliseIp, parseCidr, parseIp } from '@/shared/lib/ip';
import { maskIp } from '@/shared/lib/mask-ip';

describe('maskIp', () => {
  it('keeps the /24 of IPv4', () => {
    expect(maskIp('203.0.113.7')).toBe('203.0.113.•••');
    expect(maskIp('::ffff:39.4.2.17')).toBe('39.4.2.•••');
  });

  it('keeps the /48 of IPv6', () => {
    expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3:•••');
    expect(maskIp('2001:DB8::1')).toBe('2001:db8:0:•••');
  });

  it('hides anything it cannot parse', () => {
    expect(maskIp('nope')).toBe('•••');
    expect(maskIp(null)).toBe('•••');
    expect(maskIp('fe80::1%eth0')).toBe('•••');
  });
});

describe('ip helpers', () => {
  it('normalises IPv6 (RFC 5952) and mapped IPv4', () => {
    expect(normaliseIp('2001:DB8::0001')).toBe('2001:db8::1');
    expect(normaliseIp('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1');
    expect(normaliseIp('::')).toBe('::');
    expect(normaliseIp('::ffff:39.4.2.17')).toBe('39.4.2.17');
  });

  it('rejects malformed input', () => {
    for (const bad of ['1.2.3', '1.2.3.256', '01.2.3.4', '1::2::3', 'fe80::1%eth0', '', ' ', '1.2.3.4.5', 'g::1']) {
      expect(parseIp(bad), bad).toBeNull();
    }
  });

  it('masks a range base to its prefix', () => {
    expect(normaliseCidr('10.0.0.5/8')).toBe('10.0.0.0/8');
    expect(normaliseCidr('2001:db8::1/32')).toBe('2001:db8::/32');
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(parseCidr('10.0.0.0')).toBeNull();
  });
});
