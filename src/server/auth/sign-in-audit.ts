import 'server-only';
import type { AdminContext } from '@/server/auth/types';

// Stand-in: the sign-in branch owns the real implementation (auth.sign_in once per session).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function recordSignInOnce(_ctx: AdminContext): void {}
