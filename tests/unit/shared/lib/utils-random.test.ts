import { describe, expect, it } from 'vitest';

import { generateRoomCode, generateToken, isValidRoomCode, ROOM_CODE_LENGTH } from '@/shared/lib/utils';

// utils.ts uses Web Crypto instead of Node's `crypto` so client bundles don't
// pull the Node polyfill. Same output shape as before: 16 random bytes as hex,
// and room codes from the unambiguous alphabet.
describe('random helpers (Web Crypto)', () => {
  it('generateToken returns 32 lowercase hex chars and does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generateRoomCode returns a valid room code of the fixed length', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });
});
