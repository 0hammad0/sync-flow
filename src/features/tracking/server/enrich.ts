import 'server-only';

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { isbot } from 'isbot';
import UAParser from 'ua-parser-js';

import type { Device } from '@/server/analytics/model';

/**
 * Who sent a tracker flush: IP, coarse location from Vercel's geo headers,
 * browser / OS / device from the user agent, and a bot flag. Pure functions
 * over a plain `RequestMeta`, which the route copies off the request before
 * the response, so nothing here touches the request inside `after()`.
 */

/** Plain copy of the request headers ingest needs. */
export type RequestMeta = {
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  region: string | null;
  /** URL-encoded, as Vercel sends it. */
  city: string | null;
  lat: string | null;
  lon: string | null;
  tz: string | null;
  /** Firebase session cookie, to link the visit to a signed-in account. */
  sessionCookie: string | null;
};

export type Enriched = {
  ip: string | null;
  ip_trunc: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  tz: string | null;
  browser: string | null;
  browser_version: string | null;
  os: string | null;
  device: Device;
  isBot: boolean;
};

const SESSION_COOKIE = '__session';

/**
 * Client IP. On Vercel `x-real-ip` is the client address and
 * `x-forwarded-for` is overwritten by the edge, so neither can be spoofed.
 * Anything that is not a valid IP is ignored.
 */
export function ipAddress(headers: Headers): string | null {
  const candidates = [headers.get('x-real-ip'), headers.get('x-forwarded-for')?.split(',')[0]];
  for (const raw of candidates) {
    const ip = raw?.trim();
    if (ip && isIP(ip)) return ip;
  }
  return null;
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** Copies what ingest needs off the request. Call before the response is sent. */
export function readRequestMeta(request: Request): RequestMeta {
  const h = request.headers;
  return {
    ip: ipAddress(h),
    userAgent: h.get('user-agent'),
    country: h.get('x-vercel-ip-country'),
    region: h.get('x-vercel-ip-country-region'),
    city: h.get('x-vercel-ip-city'),
    lat: h.get('x-vercel-ip-latitude'),
    lon: h.get('x-vercel-ip-longitude'),
    tz: h.get('x-vercel-ip-timezone'),
    sessionCookie: cookieValue(h.get('cookie'), SESSION_COOKIE),
  };
}

function expandIpv6(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0];
  // Embedded IPv4 tail (::ffff:1.2.3.4) → two hextets.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const o = v4[1].split('.').map(Number);
    text = `${text.slice(0, -v4[1].length)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const parse = (s: string | undefined) => (s ? s.split(':').map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  const fill = text.includes('::') ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array<number>(Math.max(fill, 0)).fill(0), ...right];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** /24 for IPv4 (`203.0.113.0`), /48 for IPv6 (`2001:db8:abcd::`). IPv4-mapped IPv6 is treated as IPv4. */
export function truncateIp(ip: string | null): string | null {
  if (!ip) return null;
  const kind = isIP(ip);
  if (kind === 4) return `${ip.split('.').slice(0, 3).join('.')}.0`;
  if (kind !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return truncateIp(mapped[1]);
  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, 3).map((g) => g.toString(16)).join(':')}::` : null;
}

/** Approximate location only: 2 decimals (~1 km). */
export function roundCoord(raw: string | null, limit: 90 | 180): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return Math.round(n * 100) / 100 + 0; // + 0 turns -0 into 0
}

function cleanText(raw: string | null, max: number): string | null {
  if (!raw) return null;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return text || null;
}

/** Vercel URL-encodes the city (`S%C3%A3o%20Paulo`). */
export function decodeCity(raw: string | null): string | null {
  if (!raw) return null;
  let city = raw;
  try {
    city = decodeURIComponent(raw);
  } catch {
    // Not valid percent-encoding: keep the raw text.
  }
  return cleanText(city, 100);
}

export type UaInfo = { browser: string | null; browser_version: string | null; os: string | null; device: Device };

/** Browser name + major version, OS name, and device class (mobile / tablet / desktop). */
export function parseUserAgent(ua: string | null): UaInfo {
  if (!ua) return { browser: null, browser_version: null, os: null, device: 'desktop' };
  const result = new UAParser(ua.slice(0, 1024)).getResult();
  const type = result.device.type;
  const device: Device = type === 'mobile' || type === 'wearable' ? 'mobile' : type === 'tablet' ? 'tablet' : 'desktop';
  return {
    browser: cleanText(result.browser.name ?? null, 40),
    browser_version: cleanText(result.browser.major ?? null, 10),
    os: cleanText(result.os.name ?? null, 40),
    device,
  };
}

/** Missing user agent counts as a bot: real browsers always send one. */
export function isBotUserAgent(ua: string | null): boolean {
  return !ua || ua.trim() === '' || isbot(ua);
}

export function enrich(meta: RequestMeta): Enriched {
  const country = meta.country && /^[A-Z]{2}$/.test(meta.country) ? meta.country : null;
  const region = meta.region && /^[A-Z0-9]{1,3}$/.test(meta.region) ? meta.region : null;
  const tz = meta.tz && /^[A-Za-z0-9_+\-/]{1,64}$/.test(meta.tz) ? meta.tz : null;
  return {
    ip: meta.ip,
    ip_trunc: truncateIp(meta.ip),
    country,
    region,
    city: decodeCity(meta.city),
    lat: roundCoord(meta.lat, 90),
    lon: roundCoord(meta.lon, 180),
    tz,
    ...parseUserAgent(meta.userAgent),
    isBot: isBotUserAgent(meta.userAgent),
  };
}

/**
 * Mode B (light) only: a daily-salted hash of IP + user agent instead of the
 * IP (Plausible's method). The salt is derived from a server secret and the
 * UTC day, so it changes every day and is the same on every instance.
 */
export function dailyVisitorHash(ip: string | null, ua: string | null, day: string, secret: string): string | null {
  if (!ip) return null;
  const salt = createHash('sha256').update(`${secret}|${day}`).digest('hex');
  return createHash('sha256').update(`${salt}|${ip}|${ua ?? ''}`).digest('hex').slice(0, 32);
}
