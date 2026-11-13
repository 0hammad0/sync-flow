import { describe, expect, it } from 'vitest';

import {
  CidrMatcher,
  compileBlocklist,
  CountryMatcher,
  DeviceMatcher,
  IpMatcher,
  UidMatcher,
} from '@/server/blocklist/matchers';
import { emptyBlocklist, type BlocklistEntry } from '@/server/blocklist/types';
import type { BlockSubject } from '@/server/blocklist/find-block';

const NOW = Date.UTC(2026, 10, 13, 14, 2);
const subject = (s: Partial<BlockSubject>): BlockSubject => ({ ip: null, uid: null, country: null, device: null, ...s });
const entry = (value: string, expiresAt: number | null = null, id = `id-${value}`): BlocklistEntry => ({ id, value, expiresAt });

describe('IpMatcher', () => {
  const m = new IpMatcher([entry('203.0.113.7'), entry('2001:db8::1')]);

  it('hits and misses', () => {
    expect(m.match(subject({ ip: '203.0.113.7' }), NOW)?.id).toBe('id-203.0.113.7');
    expect(m.match(subject({ ip: '203.0.113.8' }), NOW)).toBeNull();
    expect(m.match(subject({ ip: null }), NOW)).toBeNull();
    expect(m.match(subject({ ip: 'garbage' }), NOW)).toBeNull();
  });

  it('IPv6 is compared in normal form, any spelling', () => {
    expect(m.match(subject({ ip: '2001:DB8:0:0:0:0:0:0001' }), NOW)?.id).toBe('id-2001:db8::1');
  });

  it('IPv4-mapped IPv6 matches the IPv4 block', () => {
    expect(m.match(subject({ ip: '::ffff:203.0.113.7' }), NOW)?.id).toBe('id-203.0.113.7');
  });

  it('an expired entry never matches', () => {
    const expired = new IpMatcher([entry('203.0.113.7', NOW - 1)]);
    expect(expired.match(subject({ ip: '203.0.113.7' }), NOW)).toBeNull();
    const live = new IpMatcher([entry('203.0.113.7', NOW + 1)]);
    expect(live.match(subject({ ip: '203.0.113.7' }), NOW)).not.toBeNull();
  });
});

describe('CidrMatcher', () => {
  it('hits inside the range, misses outside', () => {
    const m = new CidrMatcher([entry('185.220.100.0/22'), entry('2001:db8::/32')]);
    expect(m.match(subject({ ip: '185.220.103.255' }), NOW)).not.toBeNull();
    expect(m.match(subject({ ip: '185.220.104.0' }), NOW)).toBeNull();
    expect(m.match(subject({ ip: '2001:db8:ffff::1' }), NOW)).not.toBeNull();
    expect(m.match(subject({ ip: '2001:db9::1' }), NOW)).toBeNull();
  });

  it('never honours /0, even if written by hand', () => {
    const m = new CidrMatcher([entry('0.0.0.0/0'), entry('::/0')]);
    expect(m.size).toBe(0);
    expect(m.match(subject({ ip: '1.2.3.4' }), NOW)).toBeNull();
  });

  it('a v4 range never matches a v6 address', () => {
    const m = new CidrMatcher([entry('10.0.0.0/8')]);
    expect(m.match(subject({ ip: '::a00:1' }), NOW)).toBeNull();
  });
});

describe('CountryMatcher', () => {
  const m = new CountryMatcher([entry('KP')]);
  it('is case-insensitive; unknown country never matches', () => {
    expect(m.match(subject({ country: 'kp' }), NOW)).not.toBeNull();
    expect(m.match(subject({ country: 'PK' }), NOW)).toBeNull();
    expect(m.match(subject({ country: null }), NOW)).toBeNull();
  });
});

describe('UidMatcher and DeviceMatcher', () => {
  it('match exactly', () => {
    expect(new UidMatcher([entry('uid-1')]).match(subject({ uid: 'uid-1' }), NOW)).not.toBeNull();
    expect(new UidMatcher([entry('uid-1')]).match(subject({ uid: 'uid-2' }), NOW)).toBeNull();
    const device = 'a'.repeat(32);
    expect(new DeviceMatcher([entry(device)]).match(subject({ device: device.toUpperCase() }), NOW)).not.toBeNull();
    expect(new DeviceMatcher([entry('not-hex')]).size).toBe(0);
  });
});

describe('compileBlocklist', () => {
  it('matches in order uid → device → IP → CIDR → country', () => {
    const list = compileBlocklist({
      ...emptyBlocklist(),
      uids: [entry('u1', null, 'uid-block')],
      ips: [entry('203.0.113.7', null, 'ip-block')],
      cidrs: [entry('203.0.113.0/24', null, 'cidr-block')],
      countries: [entry('PK', null, 'country-block')],
      version: 4,
    });
    const all = subject({ uid: 'u1', ip: '203.0.113.7', country: 'PK' });
    expect(list.match(all, NOW)?.entry.id).toBe('uid-block');
    expect(list.match({ ...all, uid: null }, NOW)?.entry.id).toBe('ip-block');
    expect(list.match({ ...all, uid: null, ip: '203.0.113.9' }, NOW)?.entry.id).toBe('cidr-block');
    expect(list.match({ ...all, uid: null, ip: '198.51.100.1' }, NOW)?.entry.id).toBe('country-block');
    expect(list.match(subject({ ip: '198.51.100.1', country: 'US' }), NOW)).toBeNull();
    expect(list.hasUids).toBe(true);
    expect(list.version).toBe(4);
  });

  it('reports empty and uid presence', () => {
    expect(compileBlocklist(emptyBlocklist()).isEmpty).toBe(true);
    expect(compileBlocklist({ ...emptyBlocklist(), ips: [entry('1.2.3.4')] }).hasUids).toBe(false);
  });
});
