import { describe, expect, it } from 'vitest';

import {
  FILE_ID_PATTERN,
  FileIdKeyError,
  createFileIdCodec,
  fileIdCodecFromEnv,
  parseFileIdKey,
  type FileRef,
} from '@/server/files/file-id';
import { TEST_FILE_ID_KEY, testFileIds } from '../../../support/file-ids';

const TOKEN = '9f1c2b3a4d5e6f708192a3b4c5d6e7f8';
const share: FileRef = { kind: 'share', token: TOKEN };
const chat: FileRef = { kind: 'chat', roomCode: 'AB7KQ2MZ', messageId: 'x8HqLm2Pz0aB9cD1eF3g', index: 2 };

describe('opaque file ids', () => {
  it('round-trips share and chat refs', () => {
    expect(testFileIds.decode(testFileIds.encode(share))).toEqual(share);
    expect(testFileIds.decode(testFileIds.encode(chat))).toEqual(chat);
  });

  it('is deterministic: one file, one id (audit rows can be searched by it)', () => {
    expect(testFileIds.encode(share)).toBe(testFileIds.encode({ kind: 'share', token: TOKEN }));
    expect(testFileIds.encode(chat)).not.toBe(testFileIds.encode({ ...chat, index: 1 }));
  });

  it('never shows the token, room code, message id or kind in readable form', () => {
    for (const ref of [share, chat]) {
      const id = testFileIds.encode(ref);
      expect(id).toMatch(FILE_ID_PATTERN);
      const raw = Buffer.from(id.slice(2), 'base64url').toString('latin1');
      for (const secret of [TOKEN, TOKEN.slice(0, 8), 'AB7KQ2MZ', 'x8HqLm2P']) {
        expect(id).not.toContain(secret);
        expect(raw).not.toContain(secret);
      }
    }
    // Same prefix for both kinds: the URL does not say which kind it is.
    expect(testFileIds.encode(share).slice(0, 2)).toBe(testFileIds.encode(chat).slice(0, 2));
  });

  it('rejects ids made with another key, edited ids and the old readable formats', () => {
    const other = createFileIdCodec(new Uint8Array(32).fill(9));
    expect(testFileIds.decode(other.encode(share))).toBeNull();

    const id = testFileIds.encode(share);
    const flipped = `${id.slice(0, 10)}${id[10] === 'A' ? 'B' : 'A'}${id.slice(11)}`;
    expect(testFileIds.decode(flipped)).toBeNull();
    expect(testFileIds.decode(id.slice(0, -2))).toBeNull();

    for (const bad of [`s_${TOKEN}`, 'c_AB7KQ2MZ_x8Hq_0', '', 'f_', 'f_short', `f_${'A'.repeat(500)}`, 'f_!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!']) {
      expect(testFileIds.decode(bad)).toBeNull();
    }
  });

  it('refuses refs it could not decode again', () => {
    expect(() => testFileIds.encode({ kind: 'share', token: 'a/b' })).toThrow();
    expect(() => testFileIds.encode({ ...chat, roomCode: 'lower123' } as FileRef)).toThrow();
    expect(() => testFileIds.encode({ ...chat, index: 1000 } as FileRef)).toThrow();
  });

  it('needs a key of at least 32 bytes', () => {
    expect(() => createFileIdCodec(new Uint8Array(16))).toThrow(FileIdKeyError);
    expect(() => parseFileIdKey(undefined)).toThrow(FileIdKeyError);
    expect(() => parseFileIdKey('too-short')).toThrow(FileIdKeyError);
    expect(parseFileIdKey(Buffer.from(TEST_FILE_ID_KEY).toString('base64')).byteLength).toBe(32);
  });

  it('reads the env key lazily: a missing key fails on use, not on construction', () => {
    const missing = fileIdCodecFromEnv(() => undefined);
    expect(() => missing.decode('f_x')).toThrow(FileIdKeyError);

    const fromEnv = fileIdCodecFromEnv(() => Buffer.from(TEST_FILE_ID_KEY).toString('base64'));
    expect(fromEnv.encode(share)).toBe(testFileIds.encode(share));
  });
});
