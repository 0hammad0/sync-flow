import { describe, expect, it } from 'vitest';

import { closeRoomSchema, roomsParamsSchema } from '@/features/admin/rooms/schemas';

describe('rooms schemas', () => {
  it('URL params fall back to safe defaults', () => {
    expect(roomsParamsSchema.parse({})).toEqual({ status: 'live' });
    expect(roomsParamsSchema.parse({ status: 'nope', ttl: '5', code: 'bad' })).toEqual({ status: 'live' });
    expect(roomsParamsSchema.parse({ status: 'history', ttl: '168', code: 'ab7kq2mz' })).toEqual({
      status: 'history',
      ttl: '168',
      code: 'AB7KQ2MZ',
    });
  });

  it('close: code shape, reason 3–200, typed code must match (case-insensitive)', () => {
    expect(closeRoomSchema.safeParse({ code: 'AB7KQ2MZ', reason: 'spam', confirm: 'ab7kq2mz' }).success).toBe(true);
    const wrong = closeRoomSchema.safeParse({ code: 'AB7KQ2MZ', reason: 'spam', confirm: 'AB7KQ2MX' });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0].path).toEqual(['confirm']);
    expect(closeRoomSchema.safeParse({ code: 'AB7KQ2MZ', reason: ' a ', confirm: 'AB7KQ2MZ' }).success).toBe(false);
    expect(closeRoomSchema.safeParse({ code: 'AB7KQ2MZ', reason: 'x'.repeat(201), confirm: 'AB7KQ2MZ' }).success).toBe(false);
    // 0, O, 1, I, L are not in the room code alphabet.
    expect(closeRoomSchema.safeParse({ code: 'AB7KQ2M0', reason: 'spam', confirm: 'AB7KQ2M0' }).success).toBe(false);
    expect(closeRoomSchema.safeParse({ code: '../x', reason: 'spam', confirm: '../x' }).success).toBe(false);
  });
});
