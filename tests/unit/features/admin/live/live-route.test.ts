import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// GET /api/admin/live: requireAdmin('analytics:read') first, JSON 401 / 403,
// IP access from the role, `?only=count` reads only the online count.

const mocks = vi.hoisted(() => ({
  requireAdminForRoute: vi.fn(),
  getLive: vi.fn(),
  countOnlineNow: vi.fn(),
  assertNotBlocked: vi.fn(),
}));

vi.mock('@/server/auth/require-admin', () => ({ requireAdminForRoute: mocks.requireAdminForRoute }));
vi.mock('@/server/blocklist/assert-not-blocked', () => ({ assertNotBlocked: mocks.assertNotBlocked }));
vi.mock('@/server/blocklist/request', () => ({
  blockedApiResponse: () => Response.json({ success: false, error: 'blocked' }, { status: 403 }),
}));
vi.mock('@/features/admin/analytics/queries', () => ({ getLive: mocks.getLive, countOnlineNow: mocks.countOnlineNow }));

const { GET } = await import('@/app/api/admin/live/route');

const ctx = (role: 'owner' | 'moderator' | 'viewer') => ({ ok: true, ctx: { uid: 'u1', email: null, role, authTime: 0 } });
const get = (query = '') => GET(new NextRequest(`http://localhost/api/admin/live${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertNotBlocked.mockResolvedValue(null);
  mocks.getLive.mockResolvedValue({ state: 'ok', data: { online: 1 } });
  mocks.countOnlineNow.mockResolvedValue({ state: 'ok', data: { count: 1, at: '2026-11-14T12:00:00.000Z' } });
});

describe('GET /api/admin/live', () => {
  it('asks for analytics:read and passes a 401 / 403 through untouched', async () => {
    mocks.requireAdminForRoute.mockResolvedValue({ ok: false, response: Response.json({ ok: false, error: 'unauthorized' }, { status: 401 }) });
    const res = await get();
    expect(mocks.requireAdminForRoute).toHaveBeenCalledWith('analytics:read');
    expect(res.status).toBe(401);
    expect(mocks.getLive).not.toHaveBeenCalled();
  });

  it('a viewer gets masked IPs; a moderator may see them', async () => {
    mocks.requireAdminForRoute.mockResolvedValue(ctx('viewer'));
    await get();
    expect(mocks.getLive).toHaveBeenLastCalledWith({ canSeeIp: false });
    mocks.requireAdminForRoute.mockResolvedValue(ctx('moderator'));
    await get();
    expect(mocks.getLive).toHaveBeenLastCalledWith({ canSeeIp: true });
  });

  it('?only=count reads only the online count, never the session list', async () => {
    mocks.requireAdminForRoute.mockResolvedValue(ctx('viewer'));
    const res = await get('?only=count');
    expect(await res.json()).toEqual({ state: 'ok', data: { count: 1, at: '2026-11-14T12:00:00.000Z' } });
    expect(mocks.getLive).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('budget is 200 (the client stops), error is 500', async () => {
    mocks.requireAdminForRoute.mockResolvedValue(ctx('owner'));
    mocks.getLive.mockResolvedValueOnce({ state: 'budget' });
    expect((await get()).status).toBe(200);
    mocks.getLive.mockResolvedValueOnce({ state: 'error', errorId: 'e1' });
    expect((await get()).status).toBe(500);
  });

  it('a blocked visitor is refused before auth', async () => {
    mocks.assertNotBlocked.mockResolvedValue({ ref: 'r1' });
    const res = await get();
    expect(res.status).toBe(403);
    expect(mocks.requireAdminForRoute).not.toHaveBeenCalled();
  });
});
