import { z } from 'zod';

// Shared by the users screen (client) and its actions and pages (server).
// Spec: docs/admin/03-features/13-users.md.

/** Firebase uids: 28 chars for email sign-in; accept the general shape (same as UserService). */
export const UID_PATTERN = /^[A-Za-z0-9]{20,128}$/;

export const USER_FILTERS = ['all', 'admins', 'disabled'] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

/** `none` removes the role claim. */
export const ROLE_CHOICES = ['none', 'viewer', 'moderator', 'owner'] as const;
export type RoleChoice = (typeof ROLE_CHOICES)[number];

/** Typed to confirm granting `owner`. */
export const OWNER_CONFIRM = 'OWNER';

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
