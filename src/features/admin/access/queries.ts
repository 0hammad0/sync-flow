import 'server-only';

import { unstable_cache } from 'next/cache';
import { can } from '@/server/auth/permissions';
import type { AdminContext } from '@/server/auth/types';
import { getBlocks } from '@/server/container';
import { statusOf } from '@/server/repositories/firestore/block-repository';
import type { BlockRecord } from '@/server/repositories/interfaces';
import { countryName } from '@/shared/lib/block-values';
import { MASK, maskIp } from '@/shared/lib/mask-ip';
import type { AccessParams } from './schemas';
import type { BlockCountsDto, BlockRowDto } from './types';

/** Cache tag for every access query. Actions call updateTag(BLOCKS_TAG) after a write. */
export const BLOCKS_TAG = 'blocks';
const PAGE_SIZE = 25;
/** Lists are cached briefly; a write on this server clears them at once (updateTag). */
const LIST_TTL_S = 30;

export function toBlockRowDto(block: BlockRecord, now: Date = new Date()): BlockRowDto {
  return {
    id: block.id,
    type: block.type,
    value: block.value,
    label: block.type === 'country' ? countryName(block.value) : null,
    reason: block.reason,
    createdBy: block.createdByEmail ?? block.createdBy,
    createdAt: block.createdAt.toISOString(),
    expiresAt: block.expiresAt?.toISOString() ?? null,
    removedAt: block.removedAt?.toISOString() ?? null,
    hits: block.hits,
    status: statusOf(block, now),
  };
}

/** Viewer (no `ip:read`): values masked like IPs; countries stay readable. */
export function maskBlockRow(row: BlockRowDto): BlockRowDto {
  switch (row.type) {
    case 'ip':
      return { ...row, value: maskIp(row.value) };
    case 'cidr': {
      const [base, prefix] = row.value.split('/');
      return { ...row, value: `${maskIp(base)}/${prefix}` };
    }
    case 'uid':
    case 'device':
      return { ...row, value: `${row.value.slice(0, 4)}${MASK}`, createdBy: row.createdBy };
    default:
      return row;
  }
}

const cachedPage = unstable_cache(
  async (status: AccessParams['status'], type: AccessParams['type'] | null, q: string | null, cursor: string | null) => {
    const page = await getBlocks().service.list({
      status,
      type: type ?? undefined,
      q: q ?? undefined,
      cursor,
      limit: PAGE_SIZE,
    });
    const now = new Date();
    return { rows: page.blocks.map((b) => toBlockRowDto(b, now)), nextCursor: page.nextCursor };
  },
  ['admin-access-list'],
  { tags: [BLOCKS_TAG], revalidate: LIST_TTL_S },
);

const cachedCounts = unstable_cache(
  async (type: AccessParams['type'] | null): Promise<BlockCountsDto> => getBlocks().service.counts(type ?? undefined),
  ['admin-access-counts'],
  { tags: [BLOCKS_TAG], revalidate: LIST_TTL_S },
);

export type BlocksPage = { rows: BlockRowDto[]; nextCursor: string | null; counts: BlockCountsDto };

/**
 * One page of blocks plus the tab counts. Firestore: 1 query (≤ 25 reads)
 * + 3 count() aggregations, cached 30 s under the `blocks` tag.
 * The caller has already passed requireAdmin('blocks:read').
 */
export async function listBlocks(ctx: AdminContext, params: AccessParams): Promise<BlocksPage> {
  const seesValues = can(ctx.role, 'ip:read');
  // A viewer may not search by value: a hit would confirm a full IP they cannot see.
  const q = seesValues ? params.q || null : null;
  const [page, counts] = await Promise.all([
    cachedPage(params.status, params.type ?? null, q, params.cursor ?? null),
    cachedCounts(params.type ?? null),
  ]);
  const rows = seesValues ? page.rows : page.rows.map(maskBlockRow);
  return { rows, nextCursor: page.nextCursor, counts };
}

/** Sidebar badge / Overview: active blocks. */
export async function countActiveBlocks(): Promise<{ count: number }> {
  return { count: (await cachedCounts(null)).active };
}
