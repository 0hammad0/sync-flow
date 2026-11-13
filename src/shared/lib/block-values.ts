// Block value rules shared by the admin block dialog (client) and
// BlockService (server), so both normalise and warn the same way.
// Spec: docs/admin/03-features/10-access-control.md ("Validation & error
// messages", "Warnings", "Hard stops").

import {
  cidrContains,
  formatCidr,
  isCgnat,
  isPrivateCidr,
  isPrivateIp,
  normaliseIp,
  parseCidr,
  parseIp,
} from './ip';

export const BLOCK_TYPES = ['ip', 'cidr', 'country', 'uid', 'device'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Access table tabs. Here (not in the zod schemas) so the client table does not pull in zod. */
export const BLOCK_STATUSES = ['active', 'expired', 'removed'] as const;
export type BlockStatusParam = (typeof BLOCK_STATUSES)[number];

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  ip: 'IP',
  cidr: 'Range',
  country: 'Country',
  uid: 'User',
  device: 'Device',
};

/** Expiry presets (SegmentedControl). `never` = no expiry. Default 24 h. */
export const BLOCK_DURATIONS = ['1h', '24h', '7d', '30d', 'never'] as const;
export type BlockDuration = (typeof BLOCK_DURATIONS)[number];
export const DEFAULT_BLOCK_DURATION: BlockDuration = '24h';

const DURATION_MS: Record<Exclude<BlockDuration, 'never'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/** End time for a preset, or null for `never`. */
export function blockExpiry(duration: BlockDuration, nowMs: number): Date | null {
  return duration === 'never' ? null : new Date(nowMs + DURATION_MS[duration]);
}

export const REASON_MIN = 3;
export const REASON_MAX = 200;

/** Narrowest prefix that is still allowed (hard stop below it). */
const TOO_WIDE: Record<4 | 6, number> = { 4: 8, 6: 16 };
/** Below this prefix the dialog warns and the action needs step-up. */
const WIDE: Record<4 | 6, number> = { 4: 16, 6: 32 };

export type NormalisedValue = { ok: true; value: string } | { ok: false; message: string };

const MESSAGES = {
  ip: 'Enter a valid IPv4 or IPv6 address.',
  cidr: 'Enter a range like 203.0.113.0/24.',
  country: 'Pick a country from the list.',
  uid: 'Enter a user id or email.',
  device: 'A device id is 32 letters and numbers (0–9, a–f).',
  zone: 'Zone ids are not allowed.',
  tooWide: 'This range is too wide to block.',
} as const;

/**
 * Turns what the admin typed into the stored form, or a field message.
 * `uid` accepts a uid or an email here; the server resolves an email to a uid.
 */
export function normaliseBlockValue(type: BlockType, raw: string): NormalisedValue {
  const text = raw.trim();
  switch (type) {
    case 'ip': {
      if (text.includes('%')) return { ok: false, message: MESSAGES.zone };
      const value = normaliseIp(text);
      return value ? { ok: true, value } : { ok: false, message: MESSAGES.ip };
    }
    case 'cidr': {
      if (text.includes('%')) return { ok: false, message: MESSAGES.zone };
      const cidr = parseCidr(text);
      if (!cidr) return { ok: false, message: MESSAGES.cidr };
      if (cidr.prefix < TOO_WIDE[cidr.version]) return { ok: false, message: MESSAGES.tooWide };
      return { ok: true, value: formatCidr(cidr) };
    }
    case 'country': {
      const code = text.toUpperCase();
      return countryName(code) ? { ok: true, value: code } : { ok: false, message: MESSAGES.country };
    }
    case 'uid': {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { ok: true, value: text.toLowerCase() };
      return /^[A-Za-z0-9_-]{1,128}$/.test(text) ? { ok: true, value: text } : { ok: false, message: MESSAGES.uid };
    }
    case 'device': {
      const id = text.toLowerCase();
      return /^[0-9a-f]{32}$/.test(id) ? { ok: true, value: id } : { ok: false, message: MESSAGES.device };
    }
  }
}

let regionNames: Intl.DisplayNames | null = null;

/** English name of an ISO 3166-1 alpha-2 code, or null when it is not a country. */
export function countryName(code: string): string | null {
  if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ' || code === 'EU' || code === 'UN') return null;
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });
    const name = regionNames.of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

export function isEmail(value: string): boolean {
  return value.includes('@');
}

export type BlockWarning = { code: 'cgnat' | 'private' | 'wide'; message: string };

/** Warnings that need "I understand". `value` must already be normalised. */
export function blockWarnings(type: BlockType, value: string): BlockWarning[] {
  const warnings: BlockWarning[] = [];
  if (type === 'ip') {
    const ip = parseIp(value);
    if (!ip) return warnings;
    if (isCgnat(ip)) warnings.push({ code: 'cgnat', message: 'This is a carrier NAT address. Many people may share it.' });
    if (isPrivateIp(ip)) {
      warnings.push({ code: 'private', message: 'This is a private address. It will never match a real visitor.' });
    }
  }
  if (type === 'cidr') {
    const cidr = parseCidr(value);
    if (!cidr) return warnings;
    if (cidr.prefix < WIDE[cidr.version]) {
      const size = cidr.version === 4 ? '65,536+ addresses' : 'a very large number of addresses';
      warnings.push({ code: 'wide', message: `This range covers ${size}.` });
    }
    if (isPrivateCidr(cidr)) {
      warnings.push({ code: 'private', message: 'This is a private address. It will never match a real visitor.' });
    }
  }
  return warnings;
}

/** Country and wide ranges need a recent sign-in and type-to-confirm. */
export function needsStepUp(type: BlockType, value: string): boolean {
  if (type === 'country') return true;
  if (type !== 'cidr') return false;
  const cidr = parseCidr(value);
  return cidr ? cidr.prefix < WIDE[cidr.version] : false;
}

/** Where the admin is right now, for the self-block hard stops. */
export type ActorLocation = { uid: string; ip: string | null; country: string | null };

/**
 * A hard stop that prevents locking yourself out, or null. `value` must be
 * normalised. Owner protection needs a user lookup, so the server adds it.
 */
export function selfBlockStop(type: BlockType, value: string, actor: ActorLocation): string | null {
  if (type === 'uid' && value === actor.uid) return 'You cannot block yourself.';
  if (type === 'country' && actor.country && value === actor.country.toUpperCase()) {
    return `You are in ${countryName(value) ?? value}. Blocking it would lock you out.`;
  }
  const ip = parseIp(actor.ip);
  if (!ip) return null;
  if (type === 'ip' && normaliseIp(value) === normaliseIp(actor.ip)) {
    return 'This is your current IP. Blocking it would lock you out.';
  }
  if (type === 'cidr') {
    const cidr = parseCidr(value);
    if (cidr && cidrContains(cidr, ip)) return 'This range contains your current IP. Blocking it would lock you out.';
  }
  return null;
}

/** Support reference: `<first 6 of id>-<yyMMddHHmm UTC>`, e.g. `K3F9QX-2611131402`. */
export function blockRef(blockId: string, nowMs: number): string {
  const d = new Date(nowMs);
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${two(d.getUTCFullYear() % 100)}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}`;
  return `${blockId.slice(0, 6).toUpperCase()}-${stamp}`;
}

/** A ref, or the 6-char id prefix in it. Used by the admin search box. */
export const BLOCK_REF_PATTERN = /^([A-Z0-9]{6})(?:-\d{10})?$/i;
