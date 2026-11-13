import type { BlockStatusParam, BlockType } from '@/shared/lib/block-values';

/** One row of the access table. Never a raw Firestore doc (06-coding-standards.md "DTO"). */
export type BlockRowDto = {
  id: string;
  type: BlockType;
  /** Masked for roles without `ip:read` (viewer). */
  value: string;
  /** Country name for country blocks, else null. */
  label: string | null;
  reason: string;
  /** Email when known, else the uid. */
  createdBy: string;
  /** ISO strings: DTOs cross the server/client boundary and the cache. */
  createdAt: string;
  expiresAt: string | null;
  removedAt: string | null;
  /** Approximate (≈): counted per instance, saved every 60 s. */
  hits: number;
  status: BlockStatusParam;
};

export type BlockCountsDto = Record<BlockStatusParam, number>;

/** Where the acting admin is now, for the dialog's self-block hard stops. */
export type AccessActorDto = { uid: string; ip: string | null; country: string | null };
