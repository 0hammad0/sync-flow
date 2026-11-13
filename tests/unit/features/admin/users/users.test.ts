import { describe, expect, it } from 'vitest';

import { toUserDetail, toUserRow, withTotals } from '@/features/admin/users/rows';
import { setUserRoleSchema, userActionSchema, usersParamsSchema } from '@/features/admin/users/schemas';
import { USER_DETAIL_KEYS } from '@/features/admin/users/types';
import type { AdminUser } from '@/server/repositories/interfaces';

const UID = 'uidTargetBBBBBBBBBBBBBBBBBBB';
const user: AdminUser = {
  uid: UID,
  email: 'sara@example.com',
  role: null,
  disabled: false,
  createdAt: new Date('2026-09-02T00:00:00Z'),
  lastSignInAt: new Date('2026-11-13T09:01:00Z'),
  lastRefreshAt: new Date('2026-11-13T10:00:00Z'),
};

describe('users schemas', () => {
  it('URL params fall back to safe defaults', () => {
    expect(usersParamsSchema.parse({})).toEqual({ filter: 'all' });
    expect(usersParamsSchema.parse({ filter: 'owners' })).toEqual({ filter: 'all' });
    expect(usersParamsSchema.parse({ filter: 'disabled', q: ' sara@example.com ' })).toEqual({ filter: 'disabled', q: 'sara@example.com' });
  });

  it('actions take a uid shape only', () => {
    expect(userActionSchema.safeParse({ uid: UID }).success).toBe(true);
    for (const uid of ['', 'short', '../../etc', `${UID}/x`]) expect(userActionSchema.safeParse({ uid }).success).toBe(false);
  });

  it('roles: list values only; granting owner needs OWNER typed', () => {
    expect(setUserRoleSchema.safeParse({ uid: UID, role: 'moderator' }).success).toBe(true);
    expect(setUserRoleSchema.safeParse({ uid: UID, role: 'none' }).success).toBe(true);
    const unknown = setUserRoleSchema.safeParse({ uid: UID, role: 'admin' });
    expect(unknown.error?.issues[0].message).toBe('Pick a role from the list.');
    expect(setUserRoleSchema.safeParse({ uid: UID, role: 'owner' }).success).toBe(false);
    expect(setUserRoleSchema.safeParse({ uid: UID, role: 'owner', confirm: 'yes' }).success).toBe(false);
    expect(setUserRoleSchema.safeParse({ uid: UID, role: 'owner', confirm: 'owner' }).success).toBe(true);
  });
});

describe('users DTOs (counts and sizes only, never file names)', () => {
  it('row and detail carry only the allowlisted keys', () => {
    const detail = toUserDetail(user, { count: 14, bytes: 412_600_000 });
    expect(Object.keys(detail).sort()).toEqual([...USER_DETAIL_KEYS].sort());
    expect(detail).toMatchObject({ fileCount: 14, fileBytes: 412_600_000, lastSeenAt: '2026-11-13T10:00:00.000Z', role: null });
    expect(toUserRow(user, null)).toMatchObject({ fileCount: null, fileBytes: null });
  });

  it('a failed aggregate leaves that row null; others still load', async () => {
    const other = { ...user, uid: 'uidOtherCCCCCCCCCCCCCCCCCCCC', email: 'ali@example.com' };
    const rows = await withTotals([user, other], async (uid) => {
      if (uid === UID) throw new Error('read cap');
      return { count: 2, bytes: 3 };
    });
    expect(rows.map((r) => [r.email, r.fileCount, r.fileBytes])).toEqual([
      ['sara@example.com', null, null],
      ['ali@example.com', 2, 3],
    ]);
  });
});
