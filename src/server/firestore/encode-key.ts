import 'server-only';

/**
 * Safe Firestore map keys for values we do not control (paths, referrer
 * hosts, cities, UTM values). Used for the `path.{p}`, `referrer.{host}`,
 * `city.{…}` maps on `a_hourly` / `a_daily`.
 *
 * Firestore field names may hold any UTF-8, but `.` splits a field path in
 * `update()` and queries, `/ [ ] * ~ \`` need back-tick quoting, and names
 * matching `__.*__` are reserved. We percent-encode those characters (and `%`
 * itself, so decoding is exact) and a leading `_`, which also keeps
 * `FOLD_KEY` (`_other`) free for the cron's fold bucket.
 *
 * Empty or missing values map to `UNKNOWN_KEY`. Long values are cut before
 * encoding, so a key stays well under Firestore's 1,500-byte field-name limit.
 */

export const UNKNOWN_KEY = '(none)';
/** Bucket the daily build folds the long tail of a map into. Never produced by encodeKey. */
export const FOLD_KEY = '_other';
export const MAX_KEY_CHARS = 200;

const SPECIAL = /[%.\/\[\]`*~]/g;

function hex(ch: string): string {
  return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
}

export function encodeKey(value: string | null | undefined): string {
  if (value === null || value === undefined) return UNKNOWN_KEY;
  const trimmed = value.trim();
  if (trimmed === '') return UNKNOWN_KEY;
  const cut = Array.from(trimmed).slice(0, MAX_KEY_CHARS).join('');
  const encoded = cut.replace(SPECIAL, hex);
  return encoded.startsWith('_') ? `%5F${encoded.slice(1)}` : encoded;
}

/** Inverse of encodeKey for display. `UNKNOWN_KEY` and `FOLD_KEY` come back unchanged. */
export function decodeKey(key: string): string {
  if (key === UNKNOWN_KEY || key === FOLD_KEY) return key;
  return key.replace(/%([0-9A-F]{2})/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}
