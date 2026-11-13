// Browser side of direct-to-R2 uploads: presign → PUT to R2 → complete.
// See src/shared/lib/upload-ticket.ts for the server side.

import { blockedError } from './blocked';

export type JsonResult = { success: boolean; error?: string; [key: string]: unknown };

/** Error text for an upload stopped through its AbortSignal. */
export const CANCELLED_MESSAGE = 'Upload cancelled.';

/** Readable message for a response that is not our JSON (platform errors, HTML pages). */
function statusMessage(status: number): string {
  if (status === 413) return 'This file is too large for the server.';
  if (status === 429) return 'Too many uploads — wait a moment and try again.';
  if (status >= 500) return `The server had a problem (HTTP ${status}). Please try again.`;
  return `Upload failed (HTTP ${status}).`;
}

/** POST JSON and always resolve to `{ success, error? }` — never throws. */
export async function postJson(url: string, body: unknown): Promise<JsonResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { success: false, error: 'Network error — check your connection and try again.' };
  }
  try {
    const data = (await res.json()) as JsonResult;
    const blocked = blockedError(data);
    if (blocked) return { success: false, error: blocked };
    if (!res.ok && data.success !== false) return { success: false, error: statusMessage(res.status) };
    return data;
  } catch {
    return { success: false, error: statusMessage(res.status) };
  }
}

/**
 * PUT the bytes to a presigned R2 URL with progress (0-100). Resolves to an
 * error message or null. Aborting `signal` stops the transfer.
 */
export function putToStorage(
  uploadUrl: string,
  body: Blob,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(CANCELLED_MESSAGE);
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = (result: string | null) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      done(xhr.status >= 200 && xhr.status < 300 ? null : `Storage rejected the upload (HTTP ${xhr.status}).`);
    });
    // A CORS rejection also lands here — the browser hides the reason.
    xhr.addEventListener('error', () =>
      done('Upload failed — network error. Check your connection and try again.')
    );
    xhr.addEventListener('abort', () => done(CANCELLED_MESSAGE));
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.send(body);
  });
}

/**
 * Full flow. `presignBody` is sent to `presignUrl`; its response must carry
 * `uploadUrl`, `contentType` and `ticket`. Then `completeBody(ticket)` is sent
 * to `completeUrl`, and that response is returned. Never throws.
 *
 * With `signal`, aborting before or during the PUT resolves to
 * `{ success: false, error: CANCELLED_MESSAGE }`.
 */
export async function directUpload(opts: {
  presignUrl: string;
  presignBody: Record<string, unknown>;
  blob: Blob;
  completeUrl: string;
  completeBody: (ticket: string) => Record<string, unknown>;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<JsonResult> {
  const cancelled: JsonResult = { success: false, error: CANCELLED_MESSAGE };
  if (opts.signal?.aborted) return cancelled;

  const presign = await postJson(opts.presignUrl, opts.presignBody);
  if (opts.signal?.aborted) return cancelled;
  if (!presign.success) return presign;
  const { uploadUrl, contentType, ticket } = presign as JsonResult & {
    uploadUrl?: string;
    contentType?: string;
    ticket?: string;
  };
  if (!uploadUrl || !contentType || !ticket) {
    return { success: false, error: 'The server sent an incomplete upload response.' };
  }

  const putError = await putToStorage(uploadUrl, opts.blob, contentType, opts.onProgress, opts.signal);
  if (putError) return { success: false, error: putError };
  // Bytes are stored: finish even if cancel was pressed now, so the
  // upload isn't left half-done (the link still gets created).
  return postJson(opts.completeUrl, opts.completeBody(ticket));
}
