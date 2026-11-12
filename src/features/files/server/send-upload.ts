// Shared server logic for phone → PC uploads. Used by the direct-to-R2 flow
// (/api/send/presign + /api/send/complete) and the legacy multipart
// POST /api/send, so both apply exactly the same rules.

import { NextResponse } from 'next/server';
import { formatFileSize, generateToken, sanitizeFileName, MAX_USER_FILES } from '@/shared/lib/utils';
import { GUEST_RECEIVED_FILE_TTL_HOURS, MAX_UPLOAD_BYTES } from '@/shared/lib/limits';
import {
  countOwnerFiles,
  createSessionFile,
  getReceiveSession,
  MAX_SESSION_FILES,
  type CreateSessionFileResult,
} from '@/shared/lib/firebase/files';
import { deleteObject } from '@/shared/lib/r2';

// Guest receivers have no My Files to fall back on, so their files are kept
// for a while after they land and then removed by /api/cleanup.
const GUEST_FILE_TTL_MS = GUEST_RECEIVED_FILE_TTL_HOURS * 60 * 60 * 1000;

const SESSION_FULL_ERROR = `Session limit reached (${MAX_SESSION_FILES} files)`;
const RECEIVER_FULL_ERROR = `The receiver has reached their file limit (${MAX_USER_FILES} files). They need to delete some files first.`;

const REFUSED: Record<
  Extract<CreateSessionFileResult, { ok: false }>['reason'],
  { error: string; status: number }
> = {
  session_not_found: { error: 'Session not found', status: 404 },
  session_full: { error: SESSION_FULL_ERROR, status: 409 },
  owner_full: { error: RECEIVER_FULL_ERROR, status: 409 },
};

export interface SendUploadPlan {
  session: string;
  token: string;
  key: string;
  name: string;
  mime: string;
  size: number;
  owner: string | null;
}

export async function planSendUpload(input: {
  sessionToken: unknown;
  originalName: unknown;
  mimeType: unknown;
  size: unknown;
}): Promise<{ plan: SendUploadPlan } | { error: NextResponse }> {
  const fail = (error: string, status = 400) => ({
    error: NextResponse.json({ success: false, error }, { status }),
  });

  const sessionToken = typeof input.sessionToken === 'string' ? input.sessionToken : '';
  const name = typeof input.originalName === 'string' ? input.originalName : '';
  const size = Number(input.size);
  if (!sessionToken || !name || !Number.isInteger(size) || size < 0) {
    return fail('Missing required fields');
  }
  if (size > MAX_UPLOAD_BYTES) {
    return fail(`File size exceeds ${formatFileSize(MAX_UPLOAD_BYTES)} limit`);
  }

  const session = await getReceiveSession(sessionToken);
  if (!session) return fail('Session not found', 404);
  if (new Date(session.expires_at) < new Date()) return fail('Session expired', 410);

  // Sessions accept multiple files until they expire (WhatsApp-style
  // batch sending from the phone) — capped to stop runaway scripts.
  // Checked early here so the phone fails fast; finishSendUpload re-checks
  // both caps, since presign tickets are stateless and could be stockpiled.
  const alreadySent = session.file_tokens?.length ?? (session.file_token ? 1 : 0);
  if (alreadySent >= MAX_SESSION_FILES) return fail(SESSION_FULL_ERROR, 409);

  if (session.receiver_id) {
    const count = await countOwnerFiles(session.receiver_id);
    if (count >= MAX_USER_FILES) return fail(RECEIVER_FULL_ERROR, 409);
  }

  const token = generateToken();
  return {
    plan: {
      session: sessionToken,
      token,
      key: `${token}/${sanitizeFileName(name)}`,
      name,
      mime:
        typeof input.mimeType === 'string' && input.mimeType
          ? input.mimeType
          : 'application/octet-stream',
      size,
      owner: session.receiver_id ?? null,
    },
  };
}

/**
 * Write the file record and attach it to the session in one transaction,
 * re-checking the session and receiver caps first. Rolls the object back when
 * a cap is hit or the write fails, so nothing over a cap stays in the bucket.
 */
export async function finishSendUpload(plan: SendUploadPlan): Promise<NextResponse> {
  let result: CreateSessionFileResult;
  try {
    result = await createSessionFile(
      plan.session,
      {
        token: plan.token,
        file_path: plan.key,
        original_name: plan.name,
        size: plan.size,
        mime_type: plan.mime,
        owner_id: plan.owner,
        is_encrypted: false,
        // Signed-in receivers keep files in My Files until they delete them.
        expires_at: plan.owner ? null : new Date(Date.now() + GUEST_FILE_TTL_MS).toISOString(),
        max_downloads: null,
      },
      MAX_USER_FILES
    );
  } catch (err) {
    console.error('Firestore write error:', err);
    await deleteObject(plan.key).catch(() => {});
    return NextResponse.json({ success: false, error: 'Failed to save file metadata' }, { status: 500 });
  }

  if (!result.ok) {
    await deleteObject(plan.key).catch(() => {});
    const { error, status } = REFUSED[result.reason];
    return NextResponse.json({ success: false, error }, { status });
  }

  return NextResponse.json({ success: true, token: plan.token });
}
