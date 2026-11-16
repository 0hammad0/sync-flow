import 'server-only';

import { unstable_cache } from 'next/cache';
import { USERS_TAG } from '@/features/admin/users/queries';
import { getContainer, getSettingsParts } from '@/server/container';
import type { StoredSettings } from '@/server/services/settings-service';
import type { AdminRoleDto, SettingsDto } from './types';

// Settings screen reads (15-settings.md "Data"). The caller has already
// passed requireAdmin('settings:write').
//
// Firestore reads per page view: 1 (admin_config/settings, never cached so
// the save's conflict check starts from the stored doc) + 1 on a roles
// cache miss (admin_config/roles; Auth getUsers calls are not Firestore
// reads). Settings reads are counted but never blocked by the read cap: the
// owner must be able to switch tracking off when the quota is in trouble.

const ROLES_TTL_S = 300;

export type SettingsLoad = { state: 'ok'; settings: SettingsDto } | { state: 'error'; errorId: string };
export type RolesLoad = { state: 'ok'; admins: AdminRoleDto[] } | { state: 'error'; errorId: string };

export function toSettingsDto(stored: StoredSettings): SettingsDto {
  return { ...stored.values, stored: stored.exists, updatedAt: stored.updatedAt?.getTime() ?? null };
}

export async function getSettings(): Promise<SettingsLoad> {
  try {
    return { state: 'ok', settings: toSettingsDto(await getSettingsParts().settings.get()) };
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error(`[admin] settings read failed ${errorId}`, error instanceof Error ? error.name : typeof error);
    return { state: 'error', errorId };
  }
}

// Under the users tag: a role change on the Users screen clears it.
const cachedAdmins = unstable_cache(
  async (): Promise<AdminRoleDto[]> =>
    (await getContainer().users.listAdmins()).map((u) => ({ uid: u.uid, email: u.email, role: u.role, disabled: u.disabled })),
  ['admin-settings-roles'],
  { tags: [USERS_TAG], revalidate: ROLES_TTL_S },
);

/** Admins from the `admin_config/roles` index (claims stay the source of truth). */
export async function listAdminRoles(): Promise<RolesLoad> {
  try {
    return { state: 'ok', admins: await cachedAdmins() };
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error(`[admin] roles list failed ${errorId}`, error instanceof Error ? error.name : typeof error);
    return { state: 'error', errorId };
  }
}
