'use client';

// One-tap downloads for chat attachments, without opening the viewer.
//
// The download URL comes from the same attachments endpoint the viewer uses
// (same room/key checks), in JSON mode: it confirms the file still exists and
// returns a short-lived R2 URL signed with `Content-Disposition: attachment`
// and the original filename. Clicking that URL makes the browser SAVE the
// file (cross-origin, so the `download` attribute alone would be ignored)
// while the chat page stays where it is.

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Download, Loader2 } from 'lucide-react';
import { downloadAllAsZip } from '@/shared/lib/zip';
import { attachmentDownloadUrl, attachmentViewUrl } from '@/features/chat/lib/chat-helpers';
import type { ChatAttachment } from '@/types';

export type DownloadStatus = 'idle' | 'loading' | 'done' | 'error';

const DONE_MS = 1600;
const ERROR_MS = 4500;

function downloadErrorText(status: number, code: unknown): string {
  if (code === 'expired' || status === 410) return 'This room has expired';
  if (code === 'file_not_found') return 'File is no longer available';
  if (code === 'not_found') return 'Room not found';
  if (status === 429) return 'Too many requests, try again';
  return 'Download failed, try again';
}

/** Fetch a fresh attachment-disposition URL and hand it to the browser. */
export async function downloadAttachment(roomCode: string, att: ChatAttachment): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${attachmentDownloadUrl(roomCode, att)}&format=json`, { cache: 'no-store' });
  } catch {
    throw new Error('Download failed, check your connection');
  }
  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; url?: unknown; error?: unknown }
    | null;
  if (!res.ok || !body?.success || typeof body.url !== 'string') {
    throw new Error(downloadErrorText(res.status, body?.error));
  }
  const link = document.createElement('a');
  link.href = body.url;
  link.download = att.name; // ignored cross-origin; the signed header names the file
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Status timers that reset to idle and are cleared on unmount. */
function useStatus() {
  const [status, setStatusState] = useState<DownloadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);
  const set = (next: DownloadStatus, message: string | null = null) => {
    if (!mounted.current) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setStatusState(next);
    setError(message);
    if (next === 'done' || next === 'error') {
      timer.current = window.setTimeout(
        () => {
          timer.current = null;
          setStatusState('idle');
          setError(null);
        },
        next === 'error' ? ERROR_MS : DONE_MS
      );
    }
  };
  return { status, error, set };
}

export interface DownloadController {
  status: DownloadStatus;
  error: string | null;
  start: () => void;
}

/** One attachment: spinner while the URL is fetched, check when started. */
export function useAttachmentDownload(roomCode: string, att: ChatAttachment): DownloadController {
  const { status, error, set } = useStatus();
  const busy = useRef(false);
  const start = () => {
    if (busy.current) return;
    busy.current = true;
    set('loading');
    downloadAttachment(roomCode, att)
      .then(() => set('done'))
      .catch((err: unknown) =>
        set('error', err instanceof Error ? err.message : 'Download failed, try again')
      )
      .finally(() => {
        busy.current = false;
      });
  };
  return { status, error, start };
}

export interface AlbumDownloadController extends DownloadController {
  progress: { done: number; total: number } | null;
}

/**
 * Whole album as ONE zip. Browsers block (or prompt for) programmatic
 * downloads after the first one, so N separate saves would mostly be lost;
 * the zip lands every file from a single tap.
 */
export function useAlbumDownload(roomCode: string, atts: ChatAttachment[]): AlbumDownloadController {
  const { status, error, set } = useStatus();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = useRef(false);
  const start = () => {
    if (busy.current || atts.length === 0) return;
    busy.current = true;
    set('loading');
    setProgress({ done: 0, total: atts.length });
    downloadAllAsZip(
      atts.map((a) => ({ name: a.name, url: attachmentViewUrl(roomCode, a.key) })),
      `syncflow-${roomCode.toLowerCase()}-files.zip`,
      (done, total) => setProgress({ done, total })
    )
      .then(({ ok, failed }) => {
        if (ok === 0) set('error', 'Files are no longer available');
        else if (failed.length > 0) set('error', `${failed.length} of ${atts.length} files failed`);
        else set('done');
      })
      .catch(() => set('error', 'Download failed, try again'))
      .finally(() => {
        busy.current = false;
        setProgress(null);
      });
  };
  return { status, error, progress, start };
}

function StatusIcon({ status, className }: { status: DownloadStatus; className: string }) {
  if (status === 'loading') return <Loader2 className={`${className} animate-spin`} aria-hidden="true" />;
  if (status === 'done') return <Check className={className} aria-hidden="true" />;
  if (status === 'error') return <AlertCircle className={className} aria-hidden="true" />;
  return <Download className={className} aria-hidden="true" />;
}

function statusLabel(status: DownloadStatus, name: string): string {
  if (status === 'loading') return `Preparing download of ${name}`;
  if (status === 'done') return `Download of ${name} started`;
  return `Download ${name}`;
}

// Keep the tap/Enter from reaching the media/card underneath (viewer, card
// action) — the button only downloads.
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Corner button on an image/video. Parent must be `relative group/media`.
 * Mouse: shows on hover/focus. Touch (no hover): always shown, small.
 */
export function MediaDownloadOverlay({
  roomCode,
  attachment,
}: {
  roomCode: string;
  attachment: ChatAttachment;
}) {
  const { status, error, start } = useAttachmentDownload(roomCode, attachment);
  const active = status !== 'idle';
  const reveal = active
    ? 'opacity-100'
    : 'opacity-0 group-hover/media:opacity-100 group-focus-within/media:opacity-100 [@media(hover:none)]:opacity-100';
  return (
    <>
      {/* Subtle corner scrim so the white icon reads on any image */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-0 right-0 h-14 w-20 rounded-tr-lg bg-linear-to-bl from-black/45 via-black/15 to-transparent transition-opacity ${reveal}`}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          start();
        }}
        onKeyDown={stop}
        onPointerDown={stop}
        disabled={status === 'loading'}
        className={`absolute top-1.5 right-1.5 z-[1] flex items-center justify-center w-8 h-8 [@media(hover:none)]:w-7 [@media(hover:none)]:h-7 rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm transition-opacity hover:bg-black/75 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white cursor-pointer disabled:cursor-wait after:absolute after:-inset-1.5 after:content-[''] ${reveal}`}
        title={statusLabel(status, attachment.name)}
        aria-label={statusLabel(status, attachment.name)}
      >
        <StatusIcon
          status={status}
          className={`w-4 h-4 [@media(hover:none)]:w-3.5 [@media(hover:none)]:h-3.5 ${
            status === 'done' ? 'text-emerald-300' : status === 'error' ? 'text-red-300' : ''
          }`}
        />
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status === 'done' ? `Download of ${attachment.name} started` : ''}
      </span>
      {error && (
        <span
          role="alert"
          className="absolute inset-x-1.5 bottom-1.5 z-[1] px-2 py-1 rounded-md bg-black/75 text-white text-[11px] leading-tight text-center pointer-events-none"
        >
          {error}
        </span>
      )}
    </>
  );
}

/**
 * Plain icon button for file cards and audio rows. Pass `controller` when
 * the card itself also starts the download, so both share one state.
 */
export function AttachmentDownloadButton({
  roomCode,
  attachment,
  mine,
  controller,
}: {
  roomCode: string;
  attachment: ChatAttachment;
  mine: boolean;
  controller?: DownloadController;
}) {
  const own = useAttachmentDownload(roomCode, attachment);
  const { status, start } = controller ?? own;
  const tone =
    status === 'done'
      ? mine
        ? 'text-emerald-200'
        : 'text-success-text'
      : status === 'error'
        ? mine
          ? 'text-red-200'
          : 'text-danger-text'
        : mine
          ? 'text-white/85 hover:text-white hover:bg-white/15'
          : 'text-fg-muted hover:text-fg hover:bg-surface-3';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        start();
      }}
      onKeyDown={stop}
      disabled={status === 'loading'}
      className={`relative shrink-0 flex items-center justify-center w-8 h-8 -my-1 rounded-full transition-colors cursor-pointer disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-1 ${
        mine ? 'focus-visible:outline-white' : 'focus-visible:outline-brand'
      } ${tone}`}
      title={statusLabel(status, attachment.name)}
      aria-label={statusLabel(status, attachment.name)}
    >
      <StatusIcon status={status} className="w-4 h-4" />
    </button>
  );
}

/** Inline error line under a card/audio row. */
export function DownloadErrorText({ error, mine }: { error: string | null; mine: boolean }) {
  if (!error) return null;
  return (
    <span role="alert" className={`block text-[10px] ${mine ? 'text-red-100' : 'text-danger-text'}`}>
      {error}
    </span>
  );
}

/** "Download all (N)" for an album header. */
export function AlbumDownloadAllButton({
  controller,
  count,
  mine,
}: {
  controller: AlbumDownloadController;
  count: number;
  mine: boolean;
}) {
  const { status, error, progress, start } = controller;
  const label =
    status === 'loading'
      ? progress && progress.done > 0
        ? `Zipping ${progress.done} / ${progress.total}…`
        : 'Preparing zip…'
      : status === 'done'
        ? 'Download started'
        : error ?? `Download all (${count})`;
  return (
    <button
      type="button"
      onClick={start}
      disabled={status === 'loading'}
      className={`flex items-center gap-1 underline cursor-pointer disabled:opacity-70 disabled:cursor-wait ${
        status === 'error'
          ? mine
            ? 'text-red-100'
            : 'text-danger-text'
          : mine
            ? 'hover:text-white'
            : 'hover:text-fg'
      }`}
      title={`Download all ${count} files as one zip`}
      aria-label={status === 'idle' ? `Download all ${count} files as a zip` : label}
      aria-live="polite"
    >
      <StatusIcon status={status} className="w-3 h-3" />
      {label}
    </button>
  );
}

/**
 * "Download" row for the long-press action sheet. Stays open while the URL
 * is fetched so the result (or error) is visible, then closes.
 */
export function SheetDownloadButton({
  roomCode,
  attachment,
  onDone,
}: {
  roomCode: string;
  attachment: ChatAttachment;
  onDone: () => void;
}) {
  const { status, error, start } = useAttachmentDownload(roomCode, attachment);
  // Callers pass an inline closure; read it through a ref so a re-render
  // doesn't cancel the pending close.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    if (status !== 'done') return;
    const t = window.setTimeout(() => onDoneRef.current(), 500);
    return () => window.clearTimeout(t);
  }, [status]);
  const label =
    status === 'loading'
      ? 'Preparing download…'
      : status === 'done'
        ? 'Download started'
        : error ?? 'Download';
  return (
    <button
      type="button"
      onClick={start}
      disabled={status === 'loading'}
      aria-label={status === 'idle' ? `Download ${attachment.name}` : label}
      className={`w-full flex items-center gap-3 px-3 py-3 text-sm rounded-xl active:bg-surface-2 hover:bg-surface-2 cursor-pointer disabled:cursor-wait text-left ${
        status === 'error' ? 'text-danger-text' : 'text-fg'
      }`}
    >
      <span className={status === 'error' ? 'text-danger-text' : 'text-fg-muted'}>
        <StatusIcon status={status} className="w-4 h-4" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
