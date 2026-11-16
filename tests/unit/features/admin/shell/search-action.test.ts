import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenError, UnauthorizedError } from '@/server/errors';

// searchAdmin order: block check → requireAdmin('analytics:read') → rate
// limit (60/min per admin) → zod (2–100 chars) → runAdminSearch.

const h = vi.hoisted(() => ({
  blocked: null as { ref: string } | null,
  requireAdmin: vi.fn(),
  run: vi.fn(),
}));

vi.mock('@/server/blocklist/assert-not-blocked', () => ({ assertNotBlocked: async () => h.blocked }));
vi.mock('@/server/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }));
vi.mock('@/features/admin/shell/search-queries', () => ({ runAdminSearch: h.run, searchLookups: {} }));

const { searchAdmin } = await import('@/features/admin/shell/actions');

let n = 0;
const ctx = () => ({ uid: `uid${++n}`.padEnd(28, 'x'), email: null, role: 'viewer', authTime: 0 });

describe('searchAdmin action', () => {
  beforeEach(() => {
    h.blocked = null;
    h.requireAdmin.mockReset();
    h.run.mockReset();
    h.run.mockResolvedValue({ groups: [], notice: null });
  });

  it('a blocked visitor is stopped before auth or any lookup', async () => {
    h.blocked = { ref: 'ABC123-2611161230' };
    expect(await searchAdmin({ q: '203.0.113.7' })).toEqual({ ok: false, error: 'blocked', ref: 'ABC123-2611161230' });
    expect(h.requireAdmin).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
  });

  it('checks analytics:read first; signed-out and forbidden never search', async () => {
    h.requireAdmin.mockRejectedValueOnce(new UnauthorizedError());
    expect(await searchAdmin({ q: 'ab' })).toMatchObject({ ok: false, error: 'unauthorized' });
    h.requireAdmin.mockRejectedValueOnce(new ForbiddenError({ permission: 'analytics:read' }));
    expect(await searchAdmin({ q: 'ab' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(h.requireAdmin).toHaveBeenCalledWith('analytics:read');
    expect(h.run).not.toHaveBeenCalled();
  });

  it('q must be 2–100 characters', async () => {
    h.requireAdmin.mockResolvedValue(ctx());
    expect(await searchAdmin({ q: 'a' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await searchAdmin({ q: 'a'.repeat(101) })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await searchAdmin(null)).toMatchObject({ ok: false, error: 'invalid' });
    expect(h.run).not.toHaveBeenCalled();
  });

  it('passes the detected shape and requireAdmin as the per-group check', async () => {
    const admin = ctx();
    h.requireAdmin.mockResolvedValue(admin);
    expect(await searchAdmin({ q: ' 203.0.113.7 ' })).toEqual({ ok: true, data: { groups: [], notice: null } });
    expect(h.run).toHaveBeenCalledWith(admin, { kind: 'ip', ip: '203.0.113.7' }, expect.objectContaining({ check: h.requireAdmin }));
  });

  it('rate limits at 60 a minute per admin', async () => {
    h.requireAdmin.mockResolvedValue(ctx());
    for (let i = 0; i < 60; i++) expect((await searchAdmin({ q: 'ab' })).ok).toBe(true);
    const limited = await searchAdmin({ q: 'ab' });
    expect(limited).toMatchObject({ ok: false, error: 'rate_limited', retryAfterSec: expect.any(Number) });
    // Another admin is not affected.
    h.requireAdmin.mockResolvedValue(ctx());
    expect((await searchAdmin({ q: 'ab' })).ok).toBe(true);
  });
});
