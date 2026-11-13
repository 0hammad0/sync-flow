// Pure IPv4 / IPv6 / CIDR helpers. No `node:net`, so the admin block dialog
// (client) and the blocklist matchers (server) share one parser and agree on
// every normalised value. Spec: docs/admin/03-features/10-access-control.md
// ("Validation", "Edge cases").
//
// Target is ES2017, so no bigint literals: BigInt(n) only.

export type IpVersion = 4 | 6;
export type ParsedIp = { version: IpVersion; value: bigint };
export type ParsedCidr = { version: IpVersion; base: bigint; prefix: number };

const ZERO = BigInt(0);
const ONE = BigInt(1);
const BITS: Record<IpVersion, number> = { 4: 32, 6: 128 };

function parseIpv4(input: string): bigint | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  let value = ZERO;
  for (const part of parts) {
    // No leading zeros ("010" is octal in some parsers), no signs, no spaces.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << BigInt(8)) | BigInt(n);
  }
  return value;
}

function parseIpv6(input: string): bigint | null {
  if (input.includes('%')) return null; // zone ids are rejected
  let text = input.toLowerCase();
  let tailV4: bigint | null = null;
  // Embedded IPv4 in the last 32 bits (::ffff:1.2.3.4, 64:ff9b::1.2.3.4).
  const lastColon = text.lastIndexOf(':');
  if (lastColon !== -1 && text.slice(lastColon + 1).includes('.')) {
    tailV4 = parseIpv4(text.slice(lastColon + 1));
    if (tailV4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? head.length + tail.length : head.length;
  if (halves.length === 1 && groups !== 8) return null;
  if (halves.length === 2 && groups > 7) return null;
  const all = halves.length === 2 ? [...head, ...Array(8 - groups).fill('0'), ...tail] : head;
  let value = ZERO;
  for (const group of all) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << BigInt(16)) | BigInt(parseInt(group, 16));
  }
  if (tailV4 !== null) value = (value & ~BigInt(0xffffffff)) | tailV4;
  return value;
}

const V4_MAPPED_PREFIX = BigInt(0xffff) << BigInt(32);
const V4_MASK = BigInt(0xffffffff);

/**
 * Parses an IPv4 or IPv6 address. IPv4-mapped IPv6 (`::ffff:1.2.3.4`) comes
 * back as IPv4, so a block and a match always compare the same form.
 * Zone ids (`fe80::1%eth0`) and anything else malformed → null.
 */
export function parseIp(input: string | null | undefined): ParsedIp | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text || text.length > 64) return null;
  if (!text.includes(':')) {
    const v4 = parseIpv4(text);
    return v4 === null ? null : { version: 4, value: v4 };
  }
  const v6 = parseIpv6(text);
  if (v6 === null) return null;
  if (v6 >> BigInt(32) === BigInt(0xffff) && (v6 & ~V4_MASK) === V4_MAPPED_PREFIX) {
    return { version: 4, value: v6 & V4_MASK };
  }
  return { version: 6, value: v6 };
}

function formatIpv4(value: bigint): string {
  const out: number[] = [];
  for (let shift = 24; shift >= 0; shift -= 8) out.push(Number((value >> BigInt(shift)) & BigInt(255)));
  return out.join('.');
}

/** RFC 5952: lowercase, no leading zeros, the longest run of 2+ zero groups as `::`. */
function formatIpv6(value: bigint): string {
  const groups: number[] = [];
  for (let shift = 112; shift >= 0; shift -= 16) groups.push(Number((value >> BigInt(shift)) & BigInt(0xffff)));
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart === -1) return hex.join(':');
  const left = hex.slice(0, bestStart).join(':');
  const right = hex.slice(bestStart + bestLen).join(':');
  return `${left}::${right}`;
}

export function formatIp(ip: ParsedIp): string {
  return ip.version === 4 ? formatIpv4(ip.value) : formatIpv6(ip.value);
}

/** `2001:DB8::0001` → `2001:db8::1`, `::ffff:39.4.2.17` → `39.4.2.17`. Invalid → null. */
export function normaliseIp(input: string | null | undefined): string | null {
  const ip = parseIp(input);
  return ip ? formatIp(ip) : null;
}

function maskFor(version: IpVersion, prefix: number): bigint {
  const bits = BITS[version];
  if (prefix <= 0) return ZERO;
  return ((ONE << BigInt(prefix)) - ONE) << BigInt(bits - prefix);
}

/**
 * `addr/prefix`. The base is masked to the prefix (`10.0.0.5/8` → `10.0.0.0/8`).
 * A mapped IPv4 base with a v6 prefix is turned into the v4 range.
 */
export function parseCidr(input: string | null | undefined): ParsedCidr | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  const slash = text.indexOf('/');
  if (slash === -1 || slash !== text.lastIndexOf('/')) return null;
  const prefixText = text.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  let prefix = Number(prefixText);
  const addrText = text.slice(0, slash);
  const ip = parseIp(addrText);
  if (!ip) return null;
  // `::ffff:10.0.0.0/104` was parsed as v4: drop the 96 mapped bits.
  if (ip.version === 4 && addrText.includes(':')) {
    if (prefix < 96) return null;
    prefix -= 96;
  }
  if (prefix > BITS[ip.version]) return null;
  return { version: ip.version, base: ip.value & maskFor(ip.version, prefix), prefix };
}

export function formatCidr(cidr: ParsedCidr): string {
  return `${formatIp({ version: cidr.version, value: cidr.base })}/${cidr.prefix}`;
}

/** `10.0.0.5/8` → `10.0.0.0/8`. Invalid → null. */
export function normaliseCidr(input: string | null | undefined): string | null {
  const cidr = parseCidr(input);
  return cidr ? formatCidr(cidr) : null;
}

export function cidrContains(cidr: ParsedCidr, ip: ParsedIp): boolean {
  if (cidr.version !== ip.version) return false;
  return (ip.value & maskFor(cidr.version, cidr.prefix)) === cidr.base;
}

const CGNAT = parseCidr('100.64.0.0/10') as ParsedCidr;
const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', 'fc00::/7', '::1/128'].map(
  (c) => parseCidr(c) as ParsedCidr,
);

/** Carrier-grade NAT (100.64.0.0/10): many people share one address. */
export function isCgnat(ip: ParsedIp): boolean {
  return cidrContains(CGNAT, ip);
}

/** Private or loopback: never a real visitor's address. */
export function isPrivateIp(ip: ParsedIp): boolean {
  return PRIVATE.some((range) => cidrContains(range, ip));
}

/** A range whose base sits in a private range. */
export function isPrivateCidr(cidr: ParsedCidr): boolean {
  return PRIVATE.some((range) => range.prefix <= cidr.prefix && cidrContains(range, { version: cidr.version, value: cidr.base }));
}
