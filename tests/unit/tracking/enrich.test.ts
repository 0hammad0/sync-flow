import { describe, expect, it } from 'vitest';

import {
  dailyVisitorHash,
  decodeCity,
  enrich,
  ipAddress,
  isBotUserAgent,
  parseUserAgent,
  readRequestMeta,
  roundCoord,
  truncateIp,
  type RequestMeta,
} from '@/features/tracking/server/enrich';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const WIN_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const HEADLESS = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36';

function meta(overrides: Partial<RequestMeta> = {}): RequestMeta {
  return {
    ip: '203.0.113.7',
    userAgent: WIN_CHROME,
    country: 'BR',
    region: 'SP',
    city: 'S%C3%A3o%20Paulo',
    lat: '-23.5475',
    lon: '-46.63611',
    tz: 'America/Sao_Paulo',
    sessionCookie: null,
    ...overrides,
  };
}

describe('geo', () => {
  it('URL-decodes the city', () => {
    expect(decodeCity('S%C3%A3o%20Paulo')).toBe('São Paulo');
    expect(decodeCity('Lahore')).toBe('Lahore');
    expect(decodeCity('%E0%A4%A')).toBe('%E0%A4%A');
    expect(decodeCity(null)).toBeNull();
  });

  it('rounds lat/lon to 2 decimals and rejects junk', () => {
    expect(roundCoord('-23.5475', 90)).toBe(-23.55);
    expect(roundCoord('74.34361', 180)).toBe(74.34);
    expect(roundCoord('-0.001', 90)).toBe(0);
    expect(Object.is(roundCoord('-0.001', 90), -0)).toBe(false);
    expect(roundCoord('91', 90)).toBeNull();
    expect(roundCoord('abc', 180)).toBeNull();
    expect(roundCoord('', 180)).toBeNull();
    expect(roundCoord(null, 180)).toBeNull();
  });

  it('enriches a request: geo, truncated IP, UA', () => {
    expect(enrich(meta())).toEqual({
      ip: '203.0.113.7',
      ip_trunc: '203.0.113.0',
      country: 'BR',
      region: 'SP',
      city: 'São Paulo',
      lat: -23.55,
      lon: -46.64,
      tz: 'America/Sao_Paulo',
      browser: 'Chrome',
      browser_version: '131',
      os: 'Windows',
      device: 'desktop',
      isBot: false,
    });
  });

  it('drops malformed geo headers', () => {
    const out = enrich(meta({ country: 'brazil', region: 'São', tz: 'x; drop table' }));
    expect(out).toMatchObject({ country: null, region: null, tz: null });
  });
});

describe('IP', () => {
  it('reads x-real-ip, then the first x-forwarded-for, and ignores non-IPs', () => {
    expect(ipAddress(new Headers({ 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '10.0.0.1' }))).toBe('198.51.100.1');
    expect(ipAddress(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe('198.51.100.2');
    expect(ipAddress(new Headers({ 'x-real-ip': 'not-an-ip' }))).toBeNull();
    expect(ipAddress(new Headers())).toBeNull();
  });

  it.each([
    ['203.0.113.7', '203.0.113.0'],
    ['2001:db8:abcd:12::1', '2001:db8:abcd::'],
    ['2001:db8::1', '2001:db8:0::'],
    ['::1', '0:0:0::'],
    ['::ffff:203.0.113.7', '203.0.113.0'],
    ['nope', null],
    [null, null],
  ])('truncates %s to %s', (ip, out) => {
    expect(truncateIp(ip)).toBe(out);
  });
});

describe('user agent', () => {
  it.each([
    [IPHONE, { browser: 'Mobile Safari', os: 'iOS', device: 'mobile' }],
    [IPAD, { os: 'iOS', device: 'tablet' }],
    [ANDROID_CHROME, { browser: 'Chrome', os: 'Android', device: 'mobile' }],
    [WIN_CHROME, { browser: 'Chrome', browser_version: '131', os: 'Windows', device: 'desktop' }],
  ])('maps %s', (ua, expected) => {
    expect(parseUserAgent(ua)).toMatchObject(expected);
  });

  it('flags bots, headless browsers and a missing UA', () => {
    expect(isBotUserAgent(GOOGLEBOT)).toBe(true);
    expect(isBotUserAgent(HEADLESS)).toBe(true);
    expect(isBotUserAgent('curl/8.4.0')).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent(IPHONE)).toBe(false);
    expect(enrich(meta({ userAgent: GOOGLEBOT })).isBot).toBe(true);
  });
});

describe('request meta', () => {
  it('copies only what ingest needs, including the session cookie', () => {
    const req = new Request('https://syncflow.example/api/e', {
      method: 'POST',
      headers: {
        'x-real-ip': '203.0.113.7',
        'user-agent': IPHONE,
        'x-vercel-ip-country': 'PK',
        'x-vercel-ip-city': 'Lahore',
        cookie: 'theme=dark; __session=abc.def.ghi; other=1',
      },
    });
    expect(readRequestMeta(req)).toMatchObject({ ip: '203.0.113.7', userAgent: IPHONE, country: 'PK', city: 'Lahore', sessionCookie: 'abc.def.ghi' });
  });
});

describe('mode B hash', () => {
  it('is stable within a day, changes the next day, and never contains the IP', () => {
    const a = dailyVisitorHash('203.0.113.7', IPHONE, '2026-11-13', 's');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).toBe(dailyVisitorHash('203.0.113.7', IPHONE, '2026-11-13', 's'));
    expect(a).not.toBe(dailyVisitorHash('203.0.113.7', IPHONE, '2026-11-14', 's'));
    expect(a).not.toBe(dailyVisitorHash('203.0.113.8', IPHONE, '2026-11-13', 's'));
    expect(dailyVisitorHash(null, IPHONE, '2026-11-13', 's')).toBeNull();
  });
});
