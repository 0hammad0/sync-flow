import 'server-only';

/**
 * STUB (phase 2 wave 1). The real version comes from phase 1 step 1.5
 * (blocklist cache, lazy, 60 s per instance) and replaces this file at merge.
 * Contract: returns the matching block, or null when the subject is not blocked.
 */
export type BlockSubject = { ip: string | null; uid: string | null; country: string | null; device: string | null };
export type BlockHit = { blockId: string; ref: string };

export async function findBlock(subject: BlockSubject): Promise<BlockHit | null> {
  void subject;
  return null;
}
