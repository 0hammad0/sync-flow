// Validation for chat attachment uploads. Shared by
// /api/chat/[roomCode]/attachments/presign (direct-to-R2) and the
// multipart POST /api/chat/[roomCode]/attachments, so both apply the same rules.

import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { roomStoragePrefix, MAX_ATTACHMENT_BYTES } from '@/shared/lib/firebase/chat';
import { generateToken, MAX_LONG_TEXT_BYTES, sanitizeFileName } from '@/shared/lib/utils';
import type { ChatAttachment } from '@/types';

export interface AttachmentPlan {
  code: string;
  key: string;
  name: string;
  size: number;
  mime: string;
  longText: boolean;
}

export function planAttachment(
  code: string,
  input: { originalName: unknown; size: unknown; mimeType: unknown; longText: boolean }
): { plan: AttachmentPlan } | { error: NextResponse } {
  const fail = (error: string, status = 400) => ({
    error: NextResponse.json({ success: false, error }, { status }),
  });
  const name = typeof input.originalName === 'string' ? input.originalName : '';
  if (!name) return fail('file and originalName required');
  const size = Number(input.size);
  if (!Number.isInteger(size) || size < 0) return fail('file and originalName required');
  if (size === 0) return fail('File is empty');
  if (size > MAX_ATTACHMENT_BYTES) return fail('File size exceeds 100MB limit', 413);
  // Long-text bodies (the overflow path for big typed messages) cap at 15MB.
  if (input.longText && size > MAX_LONG_TEXT_BYTES) {
    return fail('Message is too long (limit 15 MB).', 413);
  }
  const mime = input.longText
    ? 'text/plain; charset=utf-8'
    : typeof input.mimeType === 'string' && input.mimeType
      ? input.mimeType
      : 'application/octet-stream';
  return {
    plan: {
      code,
      key: `${roomStoragePrefix(code)}${generateToken()}/${sanitizeFileName(name)}`,
      name,
      size,
      mime,
      longText: input.longText,
    },
  };
}

/**
 * Filename to save a download as. Keys only hold the sanitized name
 * ("Résumé (1).pdf" → "R_sum_1_.pdf"), so the client may pass the original
 * name it shows — accepted only when it sanitizes back to the key's own
 * filename (exactly how planAttachment built the key). That binds it to the
 * stored object: no other name, and no other extension, can be forced.
 */
export function attachmentDownloadName(key: string, requested: string | null): string {
  const keyName = key.split('/').pop() || 'file';
  if (
    !requested ||
    requested.length > 255 ||
    /[/\\]/.test(requested) ||
    Array.from(requested).some((c) => c.charCodeAt(0) < 0x20 || c === '\x7f') ||
    sanitizeFileName(requested) !== keyName
  ) {
    return keyName;
  }
  return requested;
}

/**
 * Album files are uploaded one by one (uploadOnly), then posted together via
 * /messages. The upload step returns this proof with each file's metadata so
 * /messages only accepts files this server really stored for this room, with
 * the exact name/size/type it approved. Each key can still be posted only
 * once (see addMessage claimKeys). No expiry needed: keys live under the
 * room's prefix and die with the room.
 */
function proofPayload(code: string, att: ChatAttachment): string {
  return JSON.stringify([code, att.key, att.name, att.size, att.mime_type]);
}

function proofKey(): Buffer {
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  if (!secret) throw new Error('R2_SECRET_ACCESS_KEY is not set');
  return createHmac('sha256', secret).update('syncflow-chat-attachment-proof-v1').digest();
}

export function signAttachmentProof(code: string, att: ChatAttachment): string {
  return createHmac('sha256', proofKey()).update(proofPayload(code, att)).digest('base64url');
}

export function isValidAttachmentProof(code: string, att: ChatAttachment, proof: unknown): boolean {
  if (typeof proof !== 'string' || proof.length > 100) return false;
  const given = Buffer.from(proof);
  const expected = Buffer.from(signAttachmentProof(code, att));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
