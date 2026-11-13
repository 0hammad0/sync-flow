import { z } from 'zod';

// Shared by the users screen (client) and its actions and pages (server).
// Spec: docs/admin/03-features/13-users.md.

import { OWNER_CONFIRM, ROLE_CHOICES, UID_PATTERN, USER_FILTERS } from './constants';

export * from './constants';

export const uidSchema = z.string().trim().regex(UID_PATTERN, 'This user no longer exists.');

/** URL params of /admin/users. The Auth page token travels in `cursor`. Unknown values fall back. */
export const usersParamsSchema = z.object({
  filter: z.enum(USER_FILTERS).catch('all'),
  q: z.string().trim().max(320).optional().catch(undefined),
  cursor: z.string().max(2000).optional().catch(undefined),
});
export type UsersParams = z.infer<typeof usersParamsSchema>;

const reason = z.string().trim().max(200, 'Keep the reason under 200 characters.').optional();

/** disableUser, enableUser, revokeUserSessions. */
export const userActionSchema = z.object({ uid: uidSchema, reason });
export type UserActionInput = z.input<typeof userActionSchema>;

export const setUserRoleSchema = z
  .object({
    uid: uidSchema,
    role: z.enum(ROLE_CHOICES, 'Pick a role from the list.'),
    confirm: z.string().trim().optional(),
    reason,
  })
  .refine((v) => v.role !== 'owner' || v.confirm?.toUpperCase() === OWNER_CONFIRM, {
    path: ['confirm'],
    message: `Type ${OWNER_CONFIRM} to confirm.`,
  });
export type SetUserRoleInput = z.input<typeof setUserRoleSchema>;
