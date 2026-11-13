import type { AdminRole } from '@/server/auth/types';

// DTOs for the users screen. Counts and sizes of a user's files only, never
// file names [D-6]. Never a raw Auth record.

export type UserRowDto = {
  uid: string;
  email: string | null;
  role: AdminRole | null;
  disabled: boolean;
  /** ISO strings. */
  createdAt: string | null;
  lastSignInAt: string | null;
  /** Before phase 2 (a_sessions): Auth's last token refresh. */
  lastSeenAt: string | null;
  /** Share files owned by the user (count() + sum(size), one aggregate). null = not read. */
  fileCount: number | null;
  fileBytes: number | null;
};

export type UserDetailDto = UserRowDto & { lastRefreshAt: string | null };

export const USER_DETAIL_KEYS = [
  'uid',
  'email',
  'role',
  'disabled',
  'createdAt',
  'lastSignInAt',
  'lastSeenAt',
  'fileCount',
  'fileBytes',
  'lastRefreshAt',
] as const satisfies readonly (keyof UserDetailDto)[];
