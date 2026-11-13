import 'server-only';

import type { BlockType } from '@/shared/lib/block-values';

export type { BlockType };

/** One entry in the enforcement copy. `expiresAt` = epoch ms, null = never. */
export type BlocklistEntry = { id: string; value: string; expiresAt: number | null };

/** Field of `admin_config/blocklist` that holds each block type. */
export const BLOCKLIST_FIELDS = {
  ip: 'ips',
  cidr: 'cidrs',
  country: 'countries',
  uid: 'uids',
  device: 'devices',
} as const satisfies Record<BlockType, string>;

export type BlocklistField = (typeof BLOCKLIST_FIELDS)[BlockType];

/**
 * `admin_config/blocklist`, as the matchers read it. Each list holds
 * `{ id, value, expires_at }` (not bare strings) so a match can name its
 * block (ref + hit counter) and skip expired entries at match time.
 */
export type BlocklistData = Record<BlocklistField, BlocklistEntry[]> & { version: number };

/** What one lazy load returns: the blocklist and the raw admin settings doc. */
export type BlocklistSnapshot = { blocklist: BlocklistData; settings: Record<string, unknown> | null };

export function emptyBlocklist(): BlocklistData {
  return { ips: [], cidrs: [], countries: [], uids: [], devices: [], version: 0 };
}

export function isLive(entry: Pick<BlocklistEntry, 'expiresAt'>, nowMs: number): boolean {
  return entry.expiresAt === null || entry.expiresAt > nowMs;
}
