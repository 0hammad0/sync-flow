import 'server-only';

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

// Opaque admin file ids (09-files-and-storage.md "fileId format").
//
// A share file's Firestore id IS its share token, and a token in an admin URL,
// audit row or log line is a working download link (D-4). Chat attachment refs
// carry the room code and message id. So the admin never sees either: every
// file id the admin layer hands out is `f_` + base64url(siv ‖ ciphertext).
//
// Construction: deterministic authenticated encryption in the SIV pattern
// (RFC 5297's shape, with HMAC-SHA256 as the PRF instead of CMAC):
//   siv = HMAC-SHA256(macKey, plaintext)[0..16)
//   ct  = AES-256-CTR(encKey, iv = siv, plaintext)
// Decoding decrypts, recomputes the HMAC and compares in constant time, so a
// forged or edited id is rejected (16-byte tag). Both keys come from one
// server-only secret (ADMIN_FILE_ID_KEY) through HKDF.
//
// Why deterministic: the same file always gets the same id, so an audit row's
// `target_id` can be searched and its link opens the same file. Equality of
// two ids is the only thing it reveals, and that is the point of an id.
// Why not a lookup table: decoding costs no Firestore read.

/** What a file id points at. Server only: never send this to the client. */
export type FileRef =
  | { kind: 'share'; token: string }
  | { kind: 'chat'; roomCode: string; messageId: string; index: number };

export interface FileIdCodec {
  encode(ref: FileRef): string;
  /** null for anything that is not an id this key made (→ 404). Never throws on bad input. */
  decode(id: string): FileRef | null;
}

export const FILE_ID_PREFIX = 'f_';
/** Shape check before any crypto: `f_` + base64url, bounded. */
export const FILE_ID_PATTERN = /^f_[A-Za-z0-9_-]{24,400}$/;
export const FILE_ID_KEY_ENV = 'ADMIN_FILE_ID_KEY';
const MIN_KEY_BYTES = 32;
const SIV_BYTES = 16;
const HKDF_INFO = 'syncflow-admin-file-id-v1';

const ROOM_CODE = /^[A-Z0-9]{8}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SEP = '\u0000';

/** Thrown on first use when the secret is missing or too short. The page shows a setup message. */
export class FileIdKeyError extends Error {
  constructor() {
    super(`${FILE_ID_KEY_ENV} is missing or shorter than ${MIN_KEY_BYTES} bytes`);
    this.name = 'FileIdKeyError';
  }
}

function serialize(ref: FileRef): string {
  if (ref.kind === 'share') {
    if (!SAFE_ID.test(ref.token)) throw new Error('file id: bad share token');
    return `s${SEP}${ref.token}`;
  }
  if (!ROOM_CODE.test(ref.roomCode) || !SAFE_ID.test(ref.messageId) || !Number.isInteger(ref.index) || ref.index < 0 || ref.index > 999) {
    throw new Error('file id: bad chat ref');
  }
  return `c${SEP}${ref.roomCode}${SEP}${ref.messageId}${SEP}${ref.index}`;
}

function deserialize(text: string): FileRef | null {
  const parts = text.split(SEP);
  if (parts[0] === 's' && parts.length === 2 && SAFE_ID.test(parts[1])) return { kind: 'share', token: parts[1] };
  if (parts[0] === 'c' && parts.length === 4 && ROOM_CODE.test(parts[1]) && SAFE_ID.test(parts[2]) && /^\d{1,3}$/.test(parts[3])) {
    return { kind: 'chat', roomCode: parts[1], messageId: parts[2], index: Number(parts[3]) };
  }
  return null;
}

/** A codec for one key. `key` is the raw secret (≥ 32 bytes). */
export function createFileIdCodec(key: Uint8Array): FileIdCodec {
  if (key.byteLength < MIN_KEY_BYTES) throw new FileIdKeyError();
  const okm = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), HKDF_INFO, 64));
  const encKey = okm.subarray(0, 32);
  const macKey = okm.subarray(32, 64);
  const siv = (plain: Buffer) => createHmac('sha256', macKey).update(plain).digest().subarray(0, SIV_BYTES);

  return {
    encode(ref) {
      const plain = Buffer.from(serialize(ref), 'utf8');
      const iv = siv(plain);
      const cipher = createCipheriv('aes-256-ctr', encKey, iv);
      const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
      return `${FILE_ID_PREFIX}${Buffer.concat([iv, ct]).toString('base64url')}`;
    },
    decode(id) {
      if (typeof id !== 'string' || !FILE_ID_PATTERN.test(id)) return null;
      const raw = Buffer.from(id.slice(FILE_ID_PREFIX.length), 'base64url');
      if (raw.length <= SIV_BYTES) return null;
      const iv = raw.subarray(0, SIV_BYTES);
      const decipher = createDecipheriv('aes-256-ctr', encKey, iv);
      const plain = Buffer.concat([decipher.update(raw.subarray(SIV_BYTES)), decipher.final()]);
      if (!timingSafeEqual(siv(plain), iv)) return null;
      return deserialize(plain.toString('utf8'));
    },
  };
}

/** Accepts base64 / base64url (e.g. `openssl rand -base64 32`). */
export function parseFileIdKey(value: string | undefined): Uint8Array {
  const text = value?.trim() ?? '';
  const bytes = /^[A-Za-z0-9+/_-]+=*$/.test(text) ? Buffer.from(text, 'base64') : Buffer.alloc(0);
  if (bytes.byteLength < MIN_KEY_BYTES) throw new FileIdKeyError();
  return bytes;
}

/**
 * The production codec, keyed by ADMIN_FILE_ID_KEY. Lazy: nothing is read or
 * checked until the first encode/decode, so a missing key breaks only the
 * Files screen (FileIdKeyError), never the container or other pages.
 */
export function fileIdCodecFromEnv(read: () => string | undefined = () => process.env[FILE_ID_KEY_ENV]): FileIdCodec {
  let codec: FileIdCodec | null = null;
  const get = () => (codec ??= createFileIdCodec(parseFileIdKey(read())));
  return {
    encode: (ref) => get().encode(ref),
    decode: (id) => get().decode(id),
  };
}
