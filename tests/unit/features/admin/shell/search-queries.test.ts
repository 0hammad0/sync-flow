import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminRole } from '@/server/auth/types';
import { QuotaExceededError } from '@/server/quota/quota-guard';

// runAdminSearch: per-group permission (can() skip, then requireAdmin), ≤ 2
// lookups per query, quota failures become a notice. The production lookups
// are replaced, so nothing here touches Firestore or Auth.

vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('@/server/container', () => ({ getContainer: () => ({}) }));
vi.mock('@/features/admin/analytics/queries', () => ({ getSessionDetail: vi.fn() }));
vi.mock('@/features/admin/files/queries', () => ({ getFile: vi.fn() }));
vi.mock('@/features/admin/rooms/queries', () => ({ ROOMS_TAG: 'rooms' }));
vi.mock('@/features/admin/users/queries', () => ({ USERS_TAG: 'users' }));

const { runAdminSearch } = await import('@/features/admin/shell/search-queries');
const { detectQuery } = await import('@/features/admin/shell/search-detect');

const UID = 'abcdEFGHijklMNOPqrstUVWXyz12';
const HEX = '0123456789abcdef0123456789abcdef';
const ctx = (role: AdminRole) => ({ uid: UID, email: 'a@example.com', role, authTime: 0 });

function deps() {
  return {
    check: vi.fn<(permission: string) => Promise<undefined>>(async () => undefined),
    findUser: vi.fn(async (term: string) => (term === UID || term === 'ada@example.com' ? { uid: UID, email: 'ada@example.com', disabled: false } : null)),
    getRoom: vi.fn(async (code: string) => ({ code, expiresAt: new Date(Date.now() + 3600_000).toISOString() })),
    getShareFile: vi.fn(async () => ({ id: 'f_opaqueopaqueopaqueopaque01', type: 'PDF', size: 2048 })),
    getSession: vi.fn(async (id: string) => ({ id, entryPath: '/send', country: 'PK', pageviews: 3 })),
  };
}

const search = (role: AdminRole, q: string, d = deps()) => runAdminSearch(ctx(role), detectQuery(q), d);
const ids = (r: Awaited<ReturnType<typeof search>>) => r.groups.flatMap((g) => g.items.map((i) => i.id));

describe('runAdminSearch', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));

  it('IP: sessions link, block action and block search for a moderator; requireAdmin per permission', async () => {
    const d = deps();
    const r = await search('moderator', '203.0.113.7', d);
    expect(r.groups.map((g) => g.id)).toEqual(['ip']);
    expect(r.groups[0].items).toEqual([
      expect.objectContaining({ title: 'Sessions from 203.0.113.7', href: '/admin/sessions?q=203.0.113.7' }),
      expect.objectContaining({ href: null, action: { id: 'block', type: 'ip', value: '203.0.113.7' } }),
      expect.objectContaining({ href: '/admin/access?q=203.0.113.7' }),
    ]);
    expect(d.check.mock.calls.map((c) => c[0])).toEqual(['analytics:read', 'ip:read', 'blocks:write', 'blocks:read']);
  });

  it('a viewer gets no IP group and no Block action anywhere (and no auth.denied noise)', async () => {
    const d = deps();
    expect((await search('viewer', '203.0.113.7', d)).groups).toEqual([]);
    const user = await search('viewer', UID, d);
    expect(ids(user)).toEqual([`user:${UID}`, `user:sessions:${UID}`]);
    expect(JSON.stringify(user)).not.toContain('"block"');
    expect(d.check).not.toHaveBeenCalledWith('ip:read');
    expect(d.check).not.toHaveBeenCalledWith('blocks:write');
  });

  it('email: exact lookup; a miss is an info row, not an error', async () => {
    const hit = await search('owner', 'Ada@example.com');
    expect(hit.groups[0].items[0]).toMatchObject({ title: 'ada@example.com', href: `/admin/users/${UID}`, copy: UID });
    const miss = await search('owner', 'nobody@example.com');
    expect(miss.groups[0].items).toEqual([expect.objectContaining({ title: 'No user with this email.', href: null })]);
    expect(miss.notice).toBeNull();
  });

  it('room code is uppercased and opens the rooms sheet', async () => {
    const d = deps();
    const r = await search('viewer', 'ab7kq2mz', d);
    expect(d.getRoom).toHaveBeenCalledWith('AB7KQ2MZ');
    expect(r.groups[0]).toMatchObject({ id: 'room', items: [{ href: '/admin/rooms?code=AB7KQ2MZ', subtitle: 'Live room' }] });
  });

  it('32 hex: both the share file and the session are tried and shown (2 lookups, no token in the output)', async () => {
    const d = deps();
    const r = await search('viewer', HEX.toUpperCase(), d);
    expect(r.groups.map((g) => g.id)).toEqual(['file', 'session']);
    expect(d.getShareFile).toHaveBeenCalledWith(HEX);
    expect(r.groups[0].items[0].href).toBe('/admin/files/f_opaqueopaqueopaqueopaque01');
    expect(r.groups[1].items[0].href).toBe(`/admin/sessions/${HEX}`);
    expect(JSON.stringify(r.groups[0])).not.toContain(HEX);
    const calls = d.findUser.mock.calls.length + d.getRoom.mock.calls.length + d.getShareFile.mock.calls.length + d.getSession.mock.calls.length;
    expect(calls).toBe(2);
  });

  it('32 hex with no match: one info row', async () => {
    const d = deps();
    d.getShareFile.mockResolvedValue(null as never);
    d.getSession.mockResolvedValue(null as never);
    expect(ids(await search('owner', HEX, d))).toEqual(['hex:none']);
  });

  it('read budget used up: rows from that lookup are skipped and the notice says why', async () => {
    const d = deps();
    d.getSession.mockRejectedValue(new QuotaExceededError('reads', 'cap'));
    const r = await search('owner', HEX, d);
    expect(r.groups.map((g) => g.id)).toEqual(['file']);
    expect(r.notice).toBe('budget');
  });

  it('any other lookup failure: notice error, no throw, no detail leaked', async () => {
    const d = deps();
    d.getRoom.mockRejectedValue(Object.assign(new Error(`rooms/AB7KQ2MZ`), { code: 14 }));
    const r = await search('owner', 'AB7KQ2MZ', d);
    expect(r).toEqual({ groups: [], notice: 'error' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('rooms/AB7KQ2MZ');
  });

  it('block ref needs blocks:read and ip:read; text and partial IPs look nothing up', async () => {
    expect(ids(await search('moderator', 'A1B2C3-2611161230'))).toEqual(['block:A1B2C3-2611161230']);
    expect((await search('viewer', 'A1B2C3-2611161230')).groups).toEqual([]);
    const d = deps();
    expect((await search('owner', 'sessions', d)).groups).toEqual([]);
    expect((await search('owner', '39.4.2', d)).groups).toEqual([]);
    expect(d.check).not.toHaveBeenCalled();
  });

  it('caps every group at 5 rows', async () => {
    const r = await search('owner', '203.0.113.7');
    for (const g of r.groups) expect(g.items.length).toBeLessThanOrEqual(5);
  });
});
