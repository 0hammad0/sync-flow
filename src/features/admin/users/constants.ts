// Users screen constants, zod-free so client components can import them
// without pulling zod into the page's first-load JS. schemas.ts builds on these.

/** Firebase uids: 28 chars for email sign-in; accept the general shape (same as UserService). */
export const UID_PATTERN = /^[A-Za-z0-9]{20,128}$/;

export const USER_FILTERS = ['all', 'admins', 'disabled'] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

/** `none` removes the role claim. */
export const ROLE_CHOICES = ['none', 'viewer', 'moderator', 'owner'] as const;
export type RoleChoice = (typeof ROLE_CHOICES)[number];

/** Typed to confirm granting `owner`. */
export const OWNER_CONFIRM = 'OWNER';
