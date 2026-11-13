import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '@/server/services/audit-service';
import { UserService } from '@/server/services/user-service';
import { ForbiddenError } from '@/server/errors';
import { MemoryAuditRepository } from '../../../../support/memory-audit-repository';
import { MemoryUserRepository } from '../../../../support/in-memory/memory-misc-repositories';

// Users actions with the real UserService on in-memory repos: block check →
// requireAdmin(permission) → step-up (except enable) → zod → service guard.

const h = vi.hoisted(() => ({
  blocked: null as { ref: string } | null,
  requireAdmin: vi.fn(),
  updateTag: vi.fn(),
  service: null as unknown,
}));

vi.mock('@/server/blocklist/assert-not-blocked', () => ({ assertNotBlocked: async () => h.blocked }));
vi.mock('@/server/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }));
vi.mock('@/server/container', () => ({ getContainer: () => ({ users: h.service }) }));
vi.mock('next/cache', () => ({ updateTag: h.updateTag, unstable_cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest' }) }));

const { disableUser, enableUser, revokeUserSessions, setUserRole } = await import('@/features/admin/users/actions');

const OWNER = 'uidOwnerAAAAAAAAAAAAAAAAAAAA';
const TARGET = 'uidTargetBBBBBBBBBBBBBBBBBBB';
const nowSec = () => Math.floor(Date.now() / 1000);
const ctx = (authAgeSec: number) => ({ uid: OWNER, email: 'o@example.com', role: 'owner', authTime: nowSec() - authAgeSec });

describe('users actions', () => {
  let users: MemoryUserRepository;
  let audit: MemoryAuditRepository;

  beforeEach(() => {
    h.blocked = null;
    h.requireAdmin.mockReset();
    h.updateTag.mockReset();
    users = new MemoryUserRepository();
    users.addUser({ uid: OWNER, email: 'o@example.com', role: 'owner' });
    users.addUser({ uid: TARGET, email: 'sara@example.com' });
    audit = new MemoryAuditRepository();
    h.service = new UserService({ reader: users, admin: users, audit: new AuditService(audit) });
  });

  it('each action checks its own permission', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    await disableUser({ uid: TARGET });
    await enableUser({ uid: TARGET });
    await revokeUserSessions({ uid: TARGET });
    await setUserRole({ uid: TARGET, role: 'viewer' });
    expect(h.requireAdmin.mock.calls.map((c) => c[0])).toEqual(['users:disable', 'users:disable', 'users:revoke', 'roles:write']);
  });

  it('a blocked visitor never reaches auth or Firebase', async () => {
    h.blocked = { ref: 'B-9' };
    for (const action of [disableUser, enableUser, revokeUserSessions]) {
      expect(await action({ uid: TARGET })).toEqual({ ok: false, error: 'blocked', ref: 'B-9' });
    }
    expect(await setUserRole({ uid: TARGET, role: 'viewer' })).toMatchObject({ error: 'blocked' });
    expect(h.requireAdmin).not.toHaveBeenCalled();
    expect(users.calls).toEqual([]);
  });

  it('disable, revoke and set role need step-up; enable does not', async () => {
    h.requireAdmin.mockResolvedValue(ctx(16 * 60));
    expect(await disableUser({ uid: TARGET })).toMatchObject({ ok: false, error: 'step_up_required' });
    expect(await revokeUserSessions({ uid: TARGET })).toMatchObject({ ok: false, error: 'step_up_required' });
    expect(await setUserRole({ uid: TARGET, role: 'viewer' })).toMatchObject({ ok: false, error: 'step_up_required' });
    expect(users.calls).toEqual([]);
    expect(await enableUser({ uid: TARGET })).toMatchObject({ ok: true });
  });

  it('a moderator is refused (owner-only permissions)', async () => {
    h.requireAdmin.mockRejectedValue(new ForbiddenError({ uid: 'mod', email: null, permission: 'users:disable' }));
    expect(await disableUser({ uid: TARGET })).toEqual({ ok: false, error: 'forbidden' });
    expect(users.calls).toEqual([]);
  });

  it('acting on your own account is refused with the spec message, and nothing changes', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    const expected = { ok: false, error: 'forbidden', message: 'You cannot do this to your own account.' };
    expect(await disableUser({ uid: OWNER })).toEqual(expected);
    expect(await setUserRole({ uid: OWNER, role: 'none' })).toEqual(expected);
    expect(await revokeUserSessions({ uid: OWNER })).toEqual(expected);
    expect(users.calls).toEqual([]);
    expect((await audit.list({ limit: 5 })).entries).toEqual([]);
  });

  it('granting owner needs OWNER typed; unknown users are not_found', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    expect(await setUserRole({ uid: TARGET, role: 'owner' })).toMatchObject({ ok: false, error: 'invalid', fields: { confirm: expect.any(Array) } });
    expect(await setUserRole({ uid: TARGET, role: 'owner', confirm: 'OWNER' })).toEqual({
      ok: true,
      data: { uid: TARGET, disabled: false, role: 'owner' },
    });
    expect(await disableUser({ uid: 'uidMissingZZZZZZZZZZZZZZZZZZ' })).toEqual({ ok: false, error: 'not_found', message: 'This user no longer exists.' });
  });

  it('disable revokes sessions, writes user.disable, clears the users cache', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    expect(await disableUser({ uid: TARGET, reason: 'spam' })).toEqual({ ok: true, data: { uid: TARGET, disabled: true, role: null } });
    expect(users.calls).toEqual([`disabled:${TARGET}:true`, `revoke:${TARGET}`]);
    const [row] = (await audit.list({ limit: 5 })).entries;
    expect(row).toMatchObject({ action: 'user.disable', targetId: TARGET, reason: 'spam', userAgent: 'vitest' });
    expect(h.updateTag).toHaveBeenCalledWith('users');
  });
});
