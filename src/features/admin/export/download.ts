import { BLOCKED_MESSAGE } from '@/shared/lib/blocked';

// Browser side of the CSV export: the preview call, error copy, and saving
// the file. Plain functions so the dialog stays small and these stay testable.

export type ExportPreview = { rows: number; total: number; limit: number; from: string; to: string };

export type Outcome<T> = { ok: true; data: T } | { ok: false; message: string; final: boolean };

const NETWORK = "Couldn't reach the server. Check your connection and try again.";

/**
 * Copy for a failed response. `final` means trying again will not help today
 * (read budget, role), so the dialog offers Close instead of Try again.
 */
export async function failureOf(res: Response): Promise<{ message: string; final: boolean }> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  if (body?.error === 'blocked') return { message: BLOCKED_MESSAGE, final: true };
  if (res.status === 401) return { message: 'Your session ended. Sign in again, then retry.', final: true };
  if (res.status === 403 && body?.error === 'forbidden') return { message: "Your role can't export data.", final: true };
  const message = typeof body?.message === 'string' ? body.message : "Couldn't export. Try again.";
  return { message, final: res.status === 429 || res.status === 403 || res.status === 404 };
}

export async function fetchPreview(href: string, signal?: AbortSignal): Promise<Outcome<ExportPreview>> {
  try {
    const res = await fetch(href, { cache: 'no-store', signal });
    if (!res.ok) return { ok: false, ...(await failureOf(res)) };
    return { ok: true, data: (await res.json()) as ExportPreview };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    return { ok: false, message: NETWORK, final: false };
  }
}

/** `filename="…"` from Content-Disposition, or a fallback. */
export function fileNameOf(res: Response, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
  return match?.[1] ?? fallback;
}

/**
 * Fetches the whole file, then saves it. Fetch rather than a plain link: a
 * refused export (read budget) shows its reason, and a stream that breaks
 * midway fails here instead of saving a short file.
 */
export async function downloadCsv(href: string, fallbackName: string): Promise<Outcome<{ rows: number }>> {
  let res: Response;
  let blob: Blob;
  try {
    res = await fetch(href, { cache: 'no-store' });
    if (!res.ok) return { ok: false, ...(await failureOf(res)) };
    blob = await res.blob();
  } catch {
    return { ok: false, message: "Couldn't finish the download. Try again.", final: false };
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameOf(res, fallbackName);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { ok: true, data: { rows: Number(res.headers.get('x-export-rows') ?? 0) } };
}
