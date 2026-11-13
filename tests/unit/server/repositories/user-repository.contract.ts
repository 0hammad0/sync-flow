import { beforeEach, describe, expect, it } from 'vitest';

import type { UserAdmin, UserReader } from '@/server/repositories/interfaces';

export type UserSeed = { uid: string; email: string }[];

export const USER_SEED: UserSeed = [
  { uid: 'uidAAAAAAAAAAAAAAAAAAAAAAAA1', email: 'a@example.com' },
  { uid: 'uidBBBBBBBBBBBBBBBBBBBBBBBB2', email: 'b@example.com' },
  { uid: 'uidCCCCCCCCCCCCCCCCCCCCCCCC3', email: 'c@example.com' },
];

type Repo = UserReader & UserAdmin;

/** Firebase Auth users: forward paging, lookups, disable, role claim. */
export function runUserRepositoryContract(name: string, make: (seed: UserSeed) => Promise<Repo>) {
  describe(`User repository contract: ${name}`, () => {
    let repo: Repo;
    const [a, b] = USER_SEED;

    beforeEach(async () => {
      repo = await make(USER_SEED);
    });

    it('pages forward through every user', async () => {
      const seen: string[] = [];
      let pageToken: string | null = null;
      for (let i = 0; i < 10; i++) {
        const page = await repo.list({ pageToken, limit: 2 });
        expect(page.users.length).toBeLessThanOrEqual(2);
        seen.push(...page.users.map((u) => u.uid));
        if (!page.nextPageToken) break;
        pageToken = page.nextPageToken;
      }
      expect(seen.sort()).toEqual(USER_SEED.map((u) => u.uid).sort());
    });

    it('finds by uid and exact email; unknown is null', async () => {
      expect(await repo.get(a.uid)).toMatchObject({ uid: a.uid, email: a.email, role: null, disabled: false });
      expect((await repo.findByEmail(b.email))?.uid).toBe(b.uid);
      expect(await repo.get('uidZZZZZZZZZZZZZZZZZZZZZZZZ9')).toBeNull();
      expect(await repo.findByEmail('nobody@example.com')).toBeNull();
    });

    it('disables, enables and revokes', async () => {
      await repo.setDisabled(a.uid, true);
      expect((await repo.get(a.uid))?.disabled).toBe(true);
      await repo.setDisabled(a.uid, false);
      expect((await repo.get(a.uid))?.disabled).toBe(false);
      await expect(repo.revokeSessions(a.uid)).resolves.toBeUndefined();
    });

    it('sets and removes the role claim', async () => {
      const grant = { email: b.email, grantedBy: a.uid, at: new Date('2026-11-13T00:00:00Z') };
      await repo.setRole(b.uid, 'moderator', grant);
      expect((await repo.get(b.uid))?.role).toBe('moderator');
      await repo.setRole(b.uid, null, grant);
      expect((await repo.get(b.uid))?.role).toBeNull();
    });

    it('lists admins from the roles index', async () => {
      const grant = { email: null, grantedBy: a.uid, at: new Date('2026-11-13T00:00:00Z') };
      expect(await repo.listAdmins()).toEqual([]);
      await repo.setRole(b.uid, 'viewer', grant);
      await repo.setRole(a.uid, 'owner', grant);
      expect((await repo.listAdmins()).map((u) => [u.email, u.role])).toEqual([
        [a.email, 'owner'],
        [b.email, 'viewer'],
      ]);
      await repo.setRole(b.uid, null, grant);
      expect((await repo.listAdmins()).map((u) => u.uid)).toEqual([a.uid]);
    });
  });
}
