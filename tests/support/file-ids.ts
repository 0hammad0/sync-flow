import { createFileIdCodec } from '@/server/files/file-id';

/** A fixed test key. Never a real secret: 32 bytes of 0x07. */
export const TEST_FILE_ID_KEY = new Uint8Array(32).fill(7);
export const testFileIds = createFileIdCodec(TEST_FILE_ID_KEY);

/** Opaque id of a share file, as the repositories hand it out. */
export const shareId = (token: string) => testFileIds.encode({ kind: 'share', token });
/** Opaque id of one chat attachment. */
export const chatId = (roomCode: string, messageId: string, index: number) =>
  testFileIds.encode({ kind: 'chat', roomCode, messageId, index });
