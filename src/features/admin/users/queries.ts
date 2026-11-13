import 'server-only';

import { unstable_cache } from 'next/cache';
import { getContainer } from '@/server/container';
import { toUserDetail, withTotals } from './rows';
import type { UsersParams } from './schemas';
import type { UserDetailDto, UserRowDto } from './types';

// Users screen reads (13-users.md). The caller has already passed
// requireAdmin('users:read').
//
// Firestore reads per page load (cache miss): one aggregate per row
// (count + sum on `files` by owner) = 25 for a full page. Auth calls
// (listUsers, getUser, getUserByEmail, getUsers) are not Firestore reads.
// Admins filter: + 1 read (admin_config/roles). Detail: 1 aggregate.
// Cached 5 min under the `users` tag; every user action clears it.

/** Cache tag for every users query. Actions call updateTag(USERS_TAG). */
export const USERS_TAG = 'users';
const PAGE_SIZE = 25;
const TTL_S = 300;

/** `checkedAt`: when the data was read (ms), for "x ago" text that matches the cache. */
export type UsersPage = { rows: UserRowDto[]; nextCursor: string | null; checkedAt: number };
export type UserDetailPage = { user: UserDetailDto | null; checkedAt: number };

const ownerTotals = (uid: string) => getContainer().files.ownerTotals(uid);

const cachedPage = unstable_cache(
  async (pageToken: string | null): Promise<UsersPage> => {
    const page = await getContainer().users.list({ pageToken, limit: PAGE_SIZE });
    return { rows: await withTotals(page.users, ownerTotals), nextCursor: page.nextPageToken, checkedAt: Date.now() };
  },
  ['admin-users-page'],
  { tags: [USERS_TAG], revalidate: TTL_S },
);

const cachedAdmins = unstable_cache(
  async (): Promise<UsersPage> => ({
    rows: await withTotals(await getContainer().users.listAdmins(), ownerTotals),
    nextCursor: null,
    checkedAt: Date.now(),
  }),
  ['admin-users-admins'],
  { tags: [USERS_TAG], revalidate: TTL_S },
);

const cachedFind = unstable_cache(
  async (q: string): Promise<UsersPage> => {
    const user = await getContainer().users.find(q);
    return { rows: user ? await withTotals([user], ownerTotals) : [], nextCursor: null, checkedAt: Date.now() };
  },
  ['admin-users-find'],
  { tags: [USERS_TAG], revalidate: TTL_S },
);

const cachedDetail = unstable_cache(
  async (uid: string): Promise<UserDetailPage> => {
    const user = await getContainer().users.get(uid);
    if (!user) return { user: null, checkedAt: Date.now() };
    return { user: toUserDetail(user, await ownerTotals(uid).catch(() => null)), checkedAt: Date.now() };
  },
  ['admin-users-detail'],
  { tags: [USERS_TAG], revalidate: TTL_S },
);

/**
 * One page of users. Search takes a full email or a uid (Auth has no partial
 * search). `disabled` is applied to the loaded page (Auth cannot filter), so
 * a page may hold fewer than 25 rows. Forward paging only (Auth page tokens).
 */
export async function listUsers(params: UsersParams): Promise<UsersPage> {
  if (params.q) return cachedFind(params.q);
  if (params.filter === 'admins') return cachedAdmins();
  const page = await cachedPage(params.cursor ?? null);
  return params.filter === 'disabled' ? { ...page, rows: page.rows.filter((r) => r.disabled) } : page;
}

/** `user: null` when the user no longer exists. */
export function getUserDetail(uid: string): Promise<UserDetailPage> {
  return cachedDetail(uid);
}
