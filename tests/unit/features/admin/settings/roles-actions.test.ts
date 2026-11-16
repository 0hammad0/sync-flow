import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenError, UnauthorizedError } from '@/server/errors';
import { AuditService } from '@/server/services/audit-service';
import { UserService } from '@/server/services/user-service';
import { MemoryUserRepository } from '../../../../support/in-memory/memory-misc-repositories';
import { MemoryAuditRepository } from '../../../../support/memory-audit-repository';

// Settings → Roles actions (15-settings.md "Actions") with the real
// UserService on in-memory repos: requireAdmin('roles:write') → block check →
// write limit → step-up (addAdmin only) → zod → service → audit.

const h = vi.hoisted(() => ({
  blocked: null as { ref: string } | null,
  requireAdmin: vi.fn(),
  updateTag: vi.fn(),
  service: null as unknown,
}));

vi.mock('@/server/blocklist/assert-not-blocked', () => ({ assertNotBlocked: async () => h.blocked }));
vi.mock('@/server/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }));
vi.mock('@/server/container', () => ({ getContainer: () => ({ users: h.service }), getSettingsParts: () => null }));
vi.mock('next/cache', () => ({ updateTag: h.updateTag, unstable_cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest' }) }));
vi.mock('@/features/admin/analytics/queries', () => ({ ROLLUPS_TAG: 'rollups' }));

const { addAdmin, rebuildAdminIndex } = await import('@/features/admin/settings/actions');

const OWNER = 'uidOwnerAAAAAAAAAAAAAAAAAAAA';
const SARA = 'uidSaraBBBBBBBBBBBBBBBBBBBBB';
const ALI = 'uidAliCCCCCCCCCCCCCCCCCCCCCC';
const nowSec = () => Math.floor(Date.now() / 1000);
const ctx = (authAgeSec: number, uid = OWNER) => ({ uid, email: 'o@example.com', role: 'owner', authTime: nowSec() - authAgeSec });
const OLD_GRANT = { grantedBy: 'uidScript', at: new Date('2026-01-01T00:00:00Z') };

describe('settings roles actions', () => {
  let users: MemoryUserRepository;
  let audit: MemoryAuditRepository;

  beforeEach(() => {
    h.blocked = null;
    h.requireAdmin.mockReset();
    h.updateTag.mockReset();
    users = new MemoryUserRepository();
    users.addUser({ uid: OWNER, email: 'o@example.com', role: 'owner' });
    users.addUser({ uid: SARA, email: 'sara@example.com' });
    users.addUser({ uid: ALI, email: 'ali@example.com' });
    users.roles.set(OWNER, { role: 'owner', email: 'o@example.com', ...OLD_GRANT });
    audit = new MemoryAuditRepository();
    h.service = new UserService({ reader: users, admin: users, audit: new AuditService(audit) });
  });

  it('both check roles:write first, then the block check', async () => {
    const order: string[] = [];
    h.requireAdmin.mockImplementation(async (p: string) => (order.push(`auth:${p}`), ctx(60)));
    await addAdmin({ email: 'sara@example.com', role: 'viewer' });
    await rebuildAdminIndex();
    expect(order).toEqual(['auth:roles:write', 'auth:roles:write']);
  });

  it('a blocked visitor never reaches Firebase', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    h.blocked = { ref: 'B-9' };
    expect(await addAdmin({ email: 'sara@example.com', role: 'viewer' })).toEqual({ ok: false, error: 'blocked', ref: 'B-9' });
    expect(await rebuildAdminIndex()).toEqual({ ok: false, error: 'blocked', ref: 'B-9' });
    expect(users.calls).toEqual([]);
  });

  it('a moderator (403) or a signed-out caller (401) changes nothing', async () => {
    h.requireAdmin.mockRejectedValue(new ForbiddenError({ uid: 'mod', email: null, permission: 'roles:write' }));
    expect(await addAdmin({ email: 'sara@example.com', role: 'viewer' })).toEqual({ ok: false, error: 'forbidden' });
    expect(await rebuildAdminIndex()).toEqual({ ok: false, error: 'forbidden' });
    h.requireAdmin.mockRejectedValue(new UnauthorizedError());
    expect(await addAdmin({ email: 'sara@example.com', role: 'viewer' })).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(users.calls).toEqual([]);
    expect((await audit.list({ limit: 5 })).entries).toEqual([]);
  });

  it('addAdmin needs a recent sign-in; rebuild does not (spec: no step-up)', async () => {
    h.requireAdmin.mockResolvedValue(ctx(16 * 60));
    expect(await addAdmin({ email: 'sara@example.com', role: 'viewer' })).toMatchObject({ ok: false, error: 'step_up_required' });
    expect(users.calls).toEqual([]);
    expect(await rebuildAdminIndex()).toMatchObject({ ok: true });
  });

  it('addAdmin validates the email and role, and needs OWNER typed to grant owner', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    expect(await addAdmin({ email: 'not-an-email', role: 'viewer' })).toMatchObject({ error: 'invalid', fields: { email: expect.any(Array) } });
    expect(await addAdmin({ email: 'sara@example.com', role: 'none' })).toMatchObject({ error: 'invalid', fields: { role: expect.any(Array) } });
    expect(await addAdmin({ email: 'sara@example.com', role: 'owner' })).toMatchObject({ error: 'invalid', fields: { confirm: ['Type OWNER to confirm.'] } });
    expect(users.calls).toEqual([]);
    expect(await addAdmin({ email: 'sara@example.com', role: 'owner', confirm: 'owner' })).toMatchObject({ ok: true, data: { role: 'owner' } });
  });

  it('addAdmin: unknown email and your own email get the spec messages, and nothing changes', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    expect(await addAdmin({ email: 'nobody@example.com', role: 'viewer' })).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No user with that email. They must sign in once first.',
    });
    expect(await addAdmin({ email: 'o@example.com', role: 'viewer' })).toEqual({
      ok: false,
      error: 'forbidden',
      message: 'You cannot change your own role. Ask another owner.',
    });
    expect(users.calls).toEqual([]);
    expect((await audit.list({ limit: 5 })).entries).toEqual([]);
  });

  it('addAdmin sets the claim, ends their sessions, updates the index, writes role.set and clears the users cache', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    expect(await addAdmin({ email: '  Sara@Example.com ', role: 'moderator' })).toEqual({
      ok: true,
      data: { uid: SARA, email: 'sara@example.com', role: 'moderator' },
    });
    expect(users.calls).toEqual([`role:${SARA}:moderator`, `revoke:${SARA}`]);
    expect(users.roles.get(SARA)).toMatchObject({ role: 'moderator', grantedBy: OWNER });
    const [row] = (await audit.list({ limit: 5 })).entries;
    expect(row).toMatchObject({ action: 'role.set', targetId: SARA, before: { role: null }, after: { role: 'moderator' }, userAgent: 'vitest' });
    expect(h.updateTag).toHaveBeenCalledWith('users');
  });

  it('rebuild adds claims missing from the index, drops stale entries, keeps unchanged grants, and writes no audit row', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    // Claim set by hand in the console: not in the index.
    users.users.get(SARA)!.role = 'viewer';
    // Index entry with no claim left behind it.
    users.roles.set(ALI, { role: 'moderator', email: 'ali@example.com', ...OLD_GRANT });
    expect(await rebuildAdminIndex()).toEqual({ ok: true, data: { admins: 2, added: 1, removed: 1, changed: 0 } });
    expect([...users.roles.keys()].sort()).toEqual([OWNER, SARA].sort());
    expect(users.roles.get(OWNER)).toMatchObject({ grantedBy: 'uidScript' });
    expect(users.roles.get(SARA)).toMatchObject({ role: 'viewer', grantedBy: OWNER });
    expect((await audit.list({ limit: 5 })).entries).toEqual([]);
    expect(h.updateTag).toHaveBeenCalledWith('users');
  });

  it('both count against the admin write limit: 30 a minute, then rate_limited (5.4)', async () => {
    // Own uid: the limiter is per uid and lives for the whole test file.
    h.requireAdmin.mockResolvedValue(ctx(60, 'uidRateLimitedRolesEEEEEEEEE'));
    for (let i = 0; i < 30; i++) await rebuildAdminIndex();
    expect(await addAdmin({ email: 'sara@example.com', role: 'viewer' })).toEqual({ ok: false, error: 'rate_limited', retryAfterSec: expect.any(Number) });
    expect(await rebuildAdminIndex()).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(users.users.get(SARA)!.role).toBeNull();
  });
});
