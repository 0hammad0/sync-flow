import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenError, NotFoundError, UnauthorizedError, err, ok } from '@/server/errors';

// closeRoom order: block check → requireAdmin('rooms:close') → step-up →
// zod → RoomService.closeRoom → updateTag('rooms').

const h = vi.hoisted(() => ({
  blocked: null as { ref: string } | null,
  requireAdmin: vi.fn(),
  closeRoom: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock('@/server/blocklist/assert-not-blocked', () => ({ assertNotBlocked: async () => h.blocked }));
vi.mock('@/server/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }));
vi.mock('@/server/container', () => ({ getContainer: () => ({ rooms: { closeRoom: h.closeRoom } }) }));
vi.mock('next/cache', () => ({ updateTag: h.updateTag, unstable_cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest', 'x-forwarded-for': '203.0.113.7' }) }));

const { closeRoom } = await import('@/features/admin/rooms/actions');

const nowSec = () => Math.floor(Date.now() / 1000);
const ctx = (authAgeSec: number) => ({ uid: 'uidOwnerAAAAAAAAAAAAAAAAAAAA', email: 'o@example.com', role: 'owner', authTime: nowSec() - authAgeSec });
const input = { code: 'AB7KQ2MZ', reason: 'spam room', confirm: 'ab7kq2mz' };

describe('closeRoom action', () => {
  beforeEach(() => {
    h.blocked = null;
    h.requireAdmin.mockReset();
    h.closeRoom.mockReset();
    h.updateTag.mockReset();
  });

  it('a blocked visitor is stopped before any auth or delete', async () => {
    h.blocked = { ref: 'B-123' };
    expect(await closeRoom(input)).toEqual({ ok: false, error: 'blocked', ref: 'B-123' });
    expect(h.requireAdmin).not.toHaveBeenCalled();
    expect(h.closeRoom).not.toHaveBeenCalled();
  });

  it('checks rooms:close; signed-out and forbidden never reach the service', async () => {
    h.requireAdmin.mockRejectedValueOnce(new UnauthorizedError());
    expect(await closeRoom(input)).toMatchObject({ ok: false, error: 'unauthorized' });
    h.requireAdmin.mockRejectedValueOnce(new ForbiddenError({ permission: 'rooms:close' }));
    expect(await closeRoom(input)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(h.requireAdmin).toHaveBeenCalledWith('rooms:close');
    expect(h.closeRoom).not.toHaveBeenCalled();
  });

  it('needs a sign-in from the last 15 minutes (step-up) before validating or deleting', async () => {
    h.requireAdmin.mockResolvedValue(ctx(16 * 60));
    const result = await closeRoom({});
    expect(result).toMatchObject({ ok: false, error: 'step_up_required' });
    expect(h.closeRoom).not.toHaveBeenCalled();
  });

  it('rejects a wrong typed code', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    const result = await closeRoom({ ...input, confirm: 'AB7KQ2MX' });
    expect(result).toMatchObject({ ok: false, error: 'invalid', fields: { confirm: expect.any(Array) } });
    expect(h.closeRoom).not.toHaveBeenCalled();
  });

  it('closes, passes reason and request facts, clears the cache, returns counts only', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    h.closeRoom.mockResolvedValue(
      ok({ code: 'AB7KQ2MZ', deleted: { objects: 3, bytes: 4096, docs: 12 }, counts: { messageCount: 9, voiceCount: 1 } }),
    );
    const result = await closeRoom(input);
    expect(result).toEqual({ ok: true, data: { code: 'AB7KQ2MZ', messageCount: 9, fileCount: 3, totalBytes: 4096 } });
    expect(h.closeRoom).toHaveBeenCalledWith(expect.objectContaining({ role: 'owner' }), 'AB7KQ2MZ', {
      reason: 'spam room',
      request: { ip: '203.0.113.7', userAgent: 'vitest' },
    });
    expect(h.updateTag).toHaveBeenCalledWith('rooms');
  });

  it('a room that is already gone is not_found with the spec message', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    h.closeRoom.mockResolvedValue(err(new NotFoundError('room')));
    expect(await closeRoom(input)).toEqual({ ok: false, error: 'not_found', message: 'This room was already closed or expired.' });
  });

  it('an unexpected failure (R2 down) becomes internal with an error id, never a throw', async () => {
    h.requireAdmin.mockResolvedValue(ctx(60));
    h.closeRoom.mockRejectedValue(new Error('R2 refused'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await closeRoom(input)).toMatchObject({ ok: false, error: 'internal', errorId: expect.any(String) });
  });
});
