import 'server-only';

import { createHash } from 'node:crypto';

import { sanitizeDeviceId } from '@/shared/lib/utils';

/**
 * The public form of a device id. The browser keeps its raw id secret and
 * sends it on every write; only sha256(raw) is stored (messages, presence,
 * reactions), so a value read from Firestore can't be replayed to act as
 * that device. Must match deviceIdHash() in features/chat/lib/chat-helpers.ts.
 *
 * Its own module, with no Firebase or R2 imports, so light routes such as the
 * tracker ingest (`/api/e`) can hash a device id without pulling the chat
 * data layer (and the AWS SDK) into their bundle.
 */
export function deviceKey(raw: unknown): string | null {
  const id = sanitizeDeviceId(raw);
  return id ? createHash('sha256').update(id).digest('hex').slice(0, 32) : null;
}
