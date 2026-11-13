import 'server-only';

import type { Auth } from 'firebase-admin/auth';
import { isAdminRole } from '@/server/auth/permissions';
import type { BlockUserLookup } from '@/server/services/block-service';

/** Firebase Auth lookup for uid blocks: resolves an email to a uid and reads the role claim. No Firestore. */
export class FirebaseBlockUserLookup implements BlockUserLookup {
  constructor(private readonly auth: Auth) {}

  async find(uidOrEmail: string) {
    try {
      const user = uidOrEmail.includes('@')
        ? await this.auth.getUserByEmail(uidOrEmail)
        : await this.auth.getUser(uidOrEmail);
      const role = user.customClaims?.role;
      return { uid: user.uid, role: isAdminRole(role) ? role : null };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'auth/user-not-found' || code === 'auth/invalid-uid' || code === 'auth/invalid-email') return null;
      throw error;
    }
  }
}
