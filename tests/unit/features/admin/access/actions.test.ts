import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenError, ok } from '@/server/errors';

// Owner lockout (phase 1): the proxy lets POST /admin/access through
// (isBlockExempt), so these actions carry the only block check there.
// blockSubject: block check → requireAdmin. unblockSubject: requireAdmin →
// block check skipped for an owner only.

const h = vi.hoisted(() => ({
  blocked: null as { ref: string } | null,
  assertNotBlocked: vi.fn(),
  requireAdmin: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  updateTag: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@/server/blocklist/assert-not-blocked', () => ({ assertNotBlocked: h.assertNotBlocked }));
vi.mock('@/server/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }));
vi.mock('@/server/container', () => ({ getBlocks: () => ({ service: { create: h.create, remove: h.remove } }) }));
vi.mock('@/server/blocklist/cache', () => ({ getBlocklistCache: () => ({ invalidate: h.invalidate }) }));
vi.mock('next/cache', () => ({ updateTag: h.updateTag, unstable_cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest', 'x-forwarded-for': '203.0.113.7' }) }));

const { blockSubject, unblockSubject } = await import('@/features/admin/access/actions');

const ctx = (role: 'owner' | 'moderator' | 'viewer') => ({
  uid: `uid-${role}`,
  email: `${role}@example.com`,
  role,
  authTime: Math.floor(Date.now() / 1000) - 60,
});
const removed = {
  id: 'ABCDEFGHJKMNPQRSTVWX',
  type: 'ip',
  value: '203.0.113.7',
  reason: 'test',
  createdBy: 'uid-owner',
  createdByEmail: 'owner@example.com',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  expiresAt: null,
  removedAt: new Date('2026-11-16T00:00:00Z'),
  removedBy: 'uid-owner',
  hits: 0,
};

describe('access actions under a block', () => {
  beforeEach(() => {
    h.blocked = { ref: 'B-SELF01' };
    h.assertNotBlocked.mockReset().mockImplementation(async () => h.blocked);
    h.requireAdmin.mockReset();
    h.create.mockReset();
    h.remove.mockReset().mockResolvedValue(ok(removed));
    h.updateTag.mockReset();
    h.invalidate.mockReset();
  });

  it('blockSubject: a blocked owner is still refused, before auth or any write', async () => {
    h.requireAdmin.mockResolvedValue(ctx('owner'));
    const result = await blockSubject({ type: 'ip', value: '198.51.100.1', reason: 'spam', duration: '1h' });
    expect(result).toEqual({ ok: false, error: 'blocked', ref: 'B-SELF01' });
    expect(h.requireAdmin).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('unblockSubject: a blocked owner can unblock (no block check), audited by the service', async () => {
    h.requireAdmin.mockResolvedValue(ctx('owner'));
    const result = await unblockSubject({ id: removed.id });
    expect(result).toEqual({ ok: true, data: { id: removed.id, value: '203.0.113.7' } });
    expect(h.requireAdmin).toHaveBeenCalledWith('blocks:write');
    expect(h.assertNotBlocked).not.toHaveBeenCalled();
    expect(h.remove).toHaveBeenCalledWith({
      ctx: expect.objectContaining({ role: 'owner' }),
      id: removed.id,
      actor: { ip: '203.0.113.7', country: null, userAgent: 'vitest' },
    });
    expect(h.updateTag).toHaveBeenCalled();
    expect(h.invalidate).toHaveBeenCalled();
  });

  it('unblockSubject: a blocked moderator is refused, nothing removed', async () => {
    h.requireAdmin.mockResolvedValue(ctx('moderator'));
    expect(await unblockSubject({ id: removed.id })).toEqual({ ok: false, error: 'blocked', ref: 'B-SELF01' });
    expect(h.assertNotBlocked).toHaveBeenCalledTimes(1);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('unblockSubject: an unblocked moderator can unblock', async () => {
    h.blocked = null;
    h.requireAdmin.mockResolvedValue(ctx('moderator'));
    expect(await unblockSubject({ id: removed.id })).toMatchObject({ ok: true });
    expect(h.assertNotBlocked).toHaveBeenCalledTimes(1);
  });

  it('unblockSubject: auth runs first, so a blocked non-admin gets forbidden and never reaches the service', async () => {
    h.requireAdmin.mockRejectedValue(new ForbiddenError({ permission: 'blocks:write' }));
    expect(await unblockSubject({ id: removed.id })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(h.remove).not.toHaveBeenCalled();
  });
});
