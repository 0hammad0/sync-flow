import 'server-only';

import { z } from 'zod';

import type { AdminFile } from '@/server/repositories/interfaces';

// Pure mapping from stored records to AdminFile rows, shared by the Firestore
// and in-memory file repositories so both behave the same.
// D-4: chat messages are read with CHAT_FILE_FIELDS only. `content` is never
// fetched, and long-text bodies (message text stored in R2) are never rows.

/** The only message fields the admin may read. Never add `content` or `reply_to`. */
export const CHAT_FILE_FIELDS = ['attachment', 'attachments', 'created_at', 'sender_name', 'sender_id'] as const;

/** Share doc fields the admin may read. `original_name` is never fetched [D-6]. */
export const SHARE_FILE_FIELDS = [
  'file_path',
  'size',
  'mime_type',
  'owner_id',
  'created_at',
  'is_encrypted',
  'expires_at',
  'max_downloads',
  'download_count',
] as const;

const isoDate = z
  .string()
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()));
const nullableIso = isoDate.nullish().catch(null).transform((v) => v ?? null);
const nullableString = z.string().nullish().catch(null).transform((v) => v ?? null);
const nullableNumber = z.number().nullish().catch(null).transform((v) => v ?? null);

export const shareDocSchema = z.object({
  file_path: z.string(),
  size: z.number().nonnegative().catch(0),
  mime_type: z.string().catch('application/octet-stream'),
  owner_id: nullableString,
  created_at: isoDate,
  is_encrypted: z.boolean().catch(false),
  expires_at: nullableIso,
  max_downloads: nullableNumber,
  download_count: z.number().catch(0),
});

export type ShareDoc = z.infer<typeof shareDocSchema>;

const attachmentSchema = z.object({
  key: z.string(),
  size: z.number().nonnegative().catch(0),
  mime_type: z.string().catch('application/octet-stream'),
  is_long_text: z.boolean().optional().catch(undefined),
  voice: z.object({ duration_ms: z.number() }).nullish().catch(null),
  removed_at: z.string().nullish().catch(null),
});

export type StoredAttachment = z.infer<typeof attachmentSchema>;

export const chatMessageSchema = z.object({
  attachment: attachmentSchema.nullish().catch(null),
  attachments: z.array(attachmentSchema).nullish().catch(null),
  created_at: isoDate,
  sender_name: nullableString,
  sender_id: nullableString,
});

export type ChatFileMessage = z.infer<typeof chatMessageSchema>;

/** Album field first, legacy single fallback (same rule as chat.ts messageAttachments). */
export function attachmentsOf(m: Pick<ChatFileMessage, 'attachment' | 'attachments'>): StoredAttachment[] {
  if (m.attachments?.length) return m.attachments;
  return m.attachment ? [m.attachment] : [];
}

/** A row only for real files that are still stored. */
export function isListedAttachment(a: StoredAttachment): boolean {
  return !a.is_long_text && !a.removed_at;
}

// Rows carry the opaque id the caller made with its FileIdCodec. Zod drops
// every field not in the schemas above, so a file name never reaches a row.

export function shareRow(id: string, d: ShareDoc): AdminFile {
  return {
    id,
    kind: 'share',
    mimeType: d.mime_type,
    size: d.size,
    createdAt: d.created_at,
    uploaderUid: d.owner_id,
    senderName: null,
    roomCode: null,
    expiresAt: d.expires_at,
    downloadCount: d.download_count,
    maxDownloads: d.max_downloads,
    isEncrypted: d.is_encrypted,
    voiceDurationMs: null,
  };
}

/**
 * Every listed attachment of one message, in album order. Index = position in
 * attachmentsOf(). `idOf(index)` returns the opaque id of that attachment.
 */
export function chatRows(roomCode: string, m: ChatFileMessage, idOf: (index: number) => string): AdminFile[] {
  const rows: AdminFile[] = [];
  attachmentsOf(m).forEach((a, index) => {
    if (!isListedAttachment(a)) return;
    rows.push({
      id: idOf(index),
      kind: 'chat',
      mimeType: a.mime_type,
      size: a.size,
      createdAt: m.created_at,
      uploaderUid: m.sender_id,
      senderName: m.sender_name,
      roomCode,
      expiresAt: null,
      downloadCount: null,
      maxDownloads: null,
      isEncrypted: false,
      voiceDurationMs: a.voice?.duration_ms ?? null,
    });
  });
  return rows;
}

const attachmentFieldsSchema = chatMessageSchema.pick({ attachment: true, attachments: true });

type RawRecord = Record<string, unknown>;

export type AttachmentRemoval = { key: string; update: { attachment?: RawRecord; attachments?: RawRecord[] } };

/**
 * The field update that marks one attachment `removed_at`, built from the RAW
 * stored values so every other field (voice peaks, proofs) is written back
 * unchanged. null when the attachment is not there, is a long-text body, or
 * was already removed.
 */
export function attachmentRemoval(
  raw: { attachment?: unknown; attachments?: unknown },
  index: number,
  removedAt: string,
): AttachmentRemoval | null {
  const parsed = attachmentFieldsSchema.parse(raw);
  const rawAlbum = Array.isArray(raw.attachments) && raw.attachments.length > 0 ? (raw.attachments as RawRecord[]) : null;
  // A malformed album parses to null; its indexes would not match the raw array.
  if (rawAlbum && !parsed.attachments?.length) return null;
  const target = attachmentsOf(parsed)[index];
  if (!target || !isListedAttachment(target)) return null;

  const update: AttachmentRemoval['update'] = {};
  if (rawAlbum) update.attachments = rawAlbum.map((a, i) => (i === index ? { ...a, removed_at: removedAt } : a));
  // The legacy single field mirrors a one-file album; keep both in step.
  const rawSingle = raw.attachment && typeof raw.attachment === 'object' ? (raw.attachment as RawRecord) : null;
  if (rawSingle && rawSingle.key === target.key) update.attachment = { ...rawSingle, removed_at: removedAt };
  return { key: target.key, update };
}
