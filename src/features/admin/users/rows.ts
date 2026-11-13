import 'server-only';

import type { AdminUser, StoredBytes } from '@/server/repositories/interfaces';
import { mapLimit } from '@/features/admin/rooms/rows';
import type { UserDetailDto, UserRowDto } from './types';

// Users screen DTOs. File numbers come from one aggregate per user
// (`files` where owner_id == uid: count() + sum(size)); no file doc is read,
// so no file name can reach the screen [D-6].

/** Aggregates per page run at most this many at once (13-users.md "Performance"). */
export const TOTALS_CONCURRENCY = 10;

type OwnerTotals = (uid: string) => Promise<StoredBytes>;

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function toUserRow(user: AdminUser, totals: StoredBytes | null): UserRowDto {
  return {
    uid: user.uid,
    email: user.email,
    role: user.role,
    disabled: user.disabled,
    createdAt: iso(user.createdAt),
    lastSignInAt: iso(user.lastSignInAt),
    lastSeenAt: iso(user.lastRefreshAt),
    fileCount: totals?.count ?? null,
    fileBytes: totals?.bytes ?? null,
  };
}

export function toUserDetail(user: AdminUser, totals: StoredBytes | null): UserDetailDto {
  return { ...toUserRow(user, totals), lastRefreshAt: iso(user.lastRefreshAt) };
}

/** Rows with file totals. A failed (or over-budget) aggregate leaves that row's numbers null. */
export function withTotals(users: readonly AdminUser[], ownerTotals: OwnerTotals): Promise<UserRowDto[]> {
  return mapLimit(users, TOTALS_CONCURRENCY, async (user) => toUserRow(user, await ownerTotals(user.uid).catch(() => null)));
}
