import 'server-only';

import { cidrContains, normaliseIp, parseCidr, parseIp, type ParsedCidr } from '@/shared/lib/ip';
import type { BlockSubject } from './find-block';
import { isLive, type BlocklistData, type BlocklistEntry, type BlockType } from './types';

/**
 * One block type. New type = new class + one line in compileBlocklist();
 * the proxy and the cache do not change (06-coding-standards.md "O").
 * Matchers are built once per cache refresh and only read afterwards.
 */
export interface BlockMatcher {
  readonly type: BlockType;
  /** Live entries the matcher holds (expired ones may still be counted until the next refresh). */
  readonly size: number;
  /** The first live entry that matches, or null. Expired entries never match. */
  match(subject: BlockSubject, nowMs: number): BlocklistEntry | null;
}

/** Exact lookups on a normalised key: O(1) per request. */
abstract class KeyedMatcher implements BlockMatcher {
  abstract readonly type: BlockType;
  private readonly byKey = new Map<string, BlocklistEntry[]>();

  constructor(entries: readonly BlocklistEntry[]) {
    for (const entry of entries) {
      const key = this.keyOf(entry.value);
      if (key === null) continue;
      const list = this.byKey.get(key);
      if (list) list.push(entry);
      else this.byKey.set(key, [entry]);
    }
  }

  get size(): number {
    let n = 0;
    for (const list of this.byKey.values()) n += list.length;
    return n;
  }

  /** Normalised key for a stored value or a subject field. null = never matches. */
  protected abstract keyOf(value: string): string | null;
  protected abstract subjectValue(subject: BlockSubject): string | null;

  match(subject: BlockSubject, nowMs: number): BlocklistEntry | null {
    const raw = this.subjectValue(subject);
    if (!raw) return null;
    const key = this.keyOf(raw);
    if (key === null) return null;
    return this.byKey.get(key)?.find((entry) => isLive(entry, nowMs)) ?? null;
  }
}

/** IPv4 and IPv6. `::ffff:1.2.3.4` and `1.2.3.4` are the same key. */
export class IpMatcher extends KeyedMatcher {
  readonly type = 'ip' as const;
  protected keyOf(value: string) {
    return normaliseIp(value);
  }
  protected subjectValue(subject: BlockSubject) {
    return subject.ip;
  }
}

/** ISO alpha-2, case-insensitive. An unknown country (null) never matches. */
export class CountryMatcher extends KeyedMatcher {
  readonly type = 'country' as const;
  protected keyOf(value: string) {
    const code = value.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : null;
  }
  protected subjectValue(subject: BlockSubject) {
    return subject.country;
  }
}

/** Firebase uid, exact. */
export class UidMatcher extends KeyedMatcher {
  readonly type = 'uid' as const;
  protected keyOf(value: string) {
    return value ? value : null;
  }
  protected subjectValue(subject: BlockSubject) {
    return subject.uid;
  }
}

/** Public device key (32 hex, the chat's sha256 of the raw device id). */
export class DeviceMatcher extends KeyedMatcher {
  readonly type = 'device' as const;
  protected keyOf(value: string) {
    const key = value.trim().toLowerCase();
    return /^[0-9a-f]{32}$/.test(key) ? key : null;
  }
  protected subjectValue(subject: BlockSubject) {
    return subject.device;
  }
}

/** Linear scan of ranges pre-parsed to bigints on refresh (≤ ~200 expected). */
export class CidrMatcher implements BlockMatcher {
  readonly type = 'cidr' as const;
  private readonly ranges: { cidr: ParsedCidr; entry: BlocklistEntry }[] = [];

  constructor(entries: readonly BlocklistEntry[]) {
    for (const entry of entries) {
      const cidr = parseCidr(entry.value);
      // A /0 would block everyone: never honoured, even if written by hand.
      if (cidr && cidr.prefix > 0) this.ranges.push({ cidr, entry });
    }
  }

  get size(): number {
    return this.ranges.length;
  }

  match(subject: BlockSubject, nowMs: number): BlocklistEntry | null {
    if (this.ranges.length === 0) return null;
    const ip = parseIp(subject.ip);
    if (!ip) return null;
    for (const { cidr, entry } of this.ranges) {
      if (isLive(entry, nowMs) && cidrContains(cidr, ip)) return entry;
    }
    return null;
  }
}

export type BlockMatch = { type: BlockType; entry: BlocklistEntry };

/**
 * Every matcher for one blocklist version, in match order:
 * uid → device → IP → CIDR → country (10-access-control.md, step 3).
 */
export class CompiledBlocklist {
  readonly matchers: readonly BlockMatcher[];

  constructor(
    readonly version: number,
    matchers: BlockMatcher[],
  ) {
    this.matchers = matchers;
  }

  /** True when any uid block exists, so callers verify the session cookie only then. */
  get hasUids(): boolean {
    return this.matchers.some((m) => m.type === 'uid' && m.size > 0);
  }

  get isEmpty(): boolean {
    return this.matchers.every((m) => m.size === 0);
  }

  match(subject: BlockSubject, nowMs: number): BlockMatch | null {
    for (const matcher of this.matchers) {
      const entry = matcher.match(subject, nowMs);
      if (entry) return { type: matcher.type, entry };
    }
    return null;
  }
}

export function compileBlocklist(data: BlocklistData): CompiledBlocklist {
  return new CompiledBlocklist(data.version, [
    new UidMatcher(data.uids),
    new DeviceMatcher(data.devices),
    new IpMatcher(data.ips),
    new CidrMatcher(data.cidrs),
    new CountryMatcher(data.countries),
  ]);
}

export const EMPTY_BLOCKLIST = compileBlocklist({ ips: [], cidrs: [], countries: [], uids: [], devices: [], version: 0 });
