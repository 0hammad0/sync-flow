'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { formatFileSize, INLINE_TEXT_BYTES } from '@/shared/lib/utils';
import { GUEST_RECEIVED_FILE_TTL_HOURS, SEND_LATE_FILE_GRACE_MS } from '@/shared/lib/limits';
import { getFileByToken } from '@/features/files/server/files';
import { downloadAllAsZip } from '@/shared/lib/zip';
import { useCopy } from '@/shared/lib/clipboard';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import CopyButton from '@/shared/components/CopyButton';
import Button from '@/shared/ui/Button';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  WifiOff,
  X,
} from 'lucide-react';

interface FileInfo {
  name: string;
  size: number;
  mimeType: string;
  token: string;
  isEncrypted: boolean;
}

interface SessionInfo {
  token: string;
  sendUrl: string;
  codeUrl: string;
  code: string | null;
  signedIn: boolean;
}

type SessionStatus = 'loading' | 'waiting' | 'expired' | 'error';

// Text sent from the phone arrives as a small .txt file; show it inline.
function isInlineText(f: FileInfo): boolean {
  return f.mimeType.startsWith('text/plain') && f.size <= INLINE_TEXT_BYTES;
}

function downloadErrorText(error: string | undefined): string {
  if (error === 'expired') return 'This file has expired.';
  if (error === 'File not found' || error === 'File not found in storage') return 'This file is no longer available.';
  return 'Download failed. Please try again.';
}

type NewSessionResult =
  | { ok: true; session: SessionInfo; expiresIn: number }
  | { ok: false; error: string };

async function requestSession(): Promise<NewSessionResult> {
  try {
    const response = await fetch('/api/receive', { method: 'POST' });
    const data = await response.json();
    if (!data.success) return { ok: false, error: data.error || 'Failed to create receive session' };
    return {
      ok: true,
      session: {
        token: data.sessionToken,
        sendUrl: data.sendUrl,
        codeUrl: data.codeUrl,
        code: typeof data.code === 'string' ? data.code : null,
        signedIn: Boolean(data.signedIn),
      },
      expiresIn: data.expiresIn,
    };
  } catch {
    return { ok: false, error: 'Failed to create receive session' };
  }
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Inline body of a text file sent from the phone, with a Copy button. */
// `undefined` = still loading, `null` = couldn't load.
function TextPreview({ text }: { text: string | null | undefined }) {
  const { copied, copy } = useCopy();
  if (text === undefined) {
    return <p className="mt-2 text-[11px] text-fg-faint">Loading text…</p>;
  }
  if (text === null) {
    return <p className="mt-2 text-[11px] text-fg-faint">Couldn&apos;t load the text — download it instead.</p>;
  }
  const trimmed = text.trim();
  const isLink = /^https?:\/\/\S+$/i.test(trimmed);
  return (
    <div className="mt-2 flex items-start gap-2">
      {isLink ? (
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 text-xs text-brand-text hover:underline break-all"
        >
          {trimmed}
        </a>
      ) : (
        <pre className="min-w-0 flex-1 max-h-48 overflow-auto p-2 bg-surface border border-edge rounded-lg text-xs text-fg font-sans whitespace-pre-wrap break-words">
          {text}
        </pre>
      )}
      <button
        type="button"
        onClick={() => copy(text)}
        className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg cursor-pointer ${
          copied ? 'bg-success/15 text-success-text' : 'bg-surface border border-edge text-fg-muted hover:text-fg'
        }`}
        aria-label={copied ? 'Copied' : 'Copy text'}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function ReceivePage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');
  // Every file received on this page, across sessions — kept until cleared,
  // so nothing disappears when the timer runs out.
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [texts, setTexts] = useState<Record<string, string | null>>({});
  const [downloading, setDownloading] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(600);
  const [reconnecting, setReconnecting] = useState(false);
  const [extending, setExtending] = useState(false);
  const [canExtend, setCanExtend] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  // True while an expired session is still polled for files that were mid-upload.
  const [listeningLate, setListeningLate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadlineRef = useRef(0);
  const requestedTexts = useRef(new Set<string>());

  const setDeadline = (seconds: number) => {
    deadlineRef.current = Date.now() + seconds * 1000;
    setTimeRemaining(seconds);
  };

  const mergeFiles = useCallback((incoming: FileInfo[]) => {
    setFiles((prev) => {
      const known = new Set(prev.map((f) => f.token));
      const fresh = incoming.filter((f) => !known.has(f.token));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }, []);

  const applySession = useCallback((result: NewSessionResult) => {
    if (result.ok) {
      setSession(result.session);
      deadlineRef.current = Date.now() + result.expiresIn * 1000;
      setTimeRemaining(result.expiresIn);
      setStatus('waiting');
    } else {
      setError(result.error);
      setStatus('error');
    }
  }, []);

  // Create session on mount
  useEffect(() => {
    let cancelled = false;
    void requestSession().then((result) => {
      if (!cancelled) applySession(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  // New session: the received list is kept until the user clears it.
  const startSession = () => {
    setStatus('loading');
    setError(null);
    setNotice(null);
    setReconnecting(false);
    setListeningLate(false);
    setCanExtend(true);
    void requestSession().then(applySession);
  };

  // Poll for uploads — the session keeps accepting files until it expires.
  // After that, keep polling for SEND_LATE_FILE_GRACE_MS: a file presigned
  // just before the end can still land, and the server still lists it.
  // Backs off after failures and says "Reconnecting…" after two in a row.
  useEffect(() => {
    if ((status !== 'waiting' && status !== 'expired') || !session) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (status === 'expired' && Date.now() > deadlineRef.current + SEND_LATE_FILE_GRACE_MS) {
        setListeningLate(false);
        return;
      }
      try {
        const response = await fetch(`/api/receive/${session.token}`, { cache: 'no-store' });
        if (cancelled) return;
        if (response.status === 410 || response.status === 404) {
          setReconnecting(false);
          setListeningLate(false);
          setStatus('expired');
          return;
        }
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.success) throw new Error('poll failed');
        failures = 0;
        setReconnecting(false);
        if (Array.isArray(data.files)) mergeFiles(data.files);
        if (data.status === 'expired') {
          // Over by the server clock. Only ever move the deadline earlier, so
          // the grace window is counted from the real end and can't slide.
          deadlineRef.current = Math.min(deadlineRef.current, Date.now());
          setListeningLate(status === 'expired');
        } else if (typeof data.expiresIn === 'number') {
          deadlineRef.current = Date.now() + data.expiresIn * 1000;
        }
      } catch {
        if (cancelled) return;
        failures++;
        if (failures >= 2) setReconnecting(true);
      }
      timer = setTimeout(tick, failures === 0 ? 2000 : Math.min(2000 * 2 ** failures, 15000));
    };

    timer = setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, session, mergeFiles]);

  // Countdown, measured against a deadline so polls and extends can move it.
  useEffect(() => {
    if (status !== 'waiting') return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setTimeRemaining(left);
      if (left === 0) setStatus('expired');
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  // Fetch the body of small text files once, for the inline preview.
  useEffect(() => {
    for (const f of files) {
      if (!isInlineText(f) || requestedTexts.current.has(f.token)) continue;
      requestedTexts.current.add(f.token);
      void (async () => {
        let text: string | null = null;
        try {
          const info = await getFileByToken(f.token);
          if (info.success && info.signedUrl) {
            const res = await fetch(info.signedUrl);
            if (res.ok) text = await res.text();
          }
        } catch {
          // falls back to the "download it instead" note
        }
        setTexts((prev) => ({ ...prev, [f.token]: text }));
      })();
    }
  }, [files]);

  // Direct download via a fresh signed URL (files from the phone are
  // unencrypted, so Content-Disposition triggers a plain download).
  const downloadOne = useCallback(async (f: FileInfo) => {
    setDownloading(f.token);
    setDownloadError(null);
    try {
      const info = await getFileByToken(f.token);
      if (info.success && info.signedUrl) {
        const link = document.createElement('a');
        link.href = info.signedUrl;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        setDownloadError(`${f.name}: ${downloadErrorText(info.error)}`);
      }
    } catch {
      setDownloadError(`${f.name}: ${downloadErrorText(undefined)}`);
    } finally {
      setDownloading(null);
    }
  }, []);

  // Browsers block programmatic downloads after the first click, so the
  // files are fetched and bundled into one zip instead of clicked one by one.
  const downloadAll = useCallback(async () => {
    setDownloading('all');
    setDownloadError(null);
    setZipProgress({ done: 0, total: files.length });
    try {
      const items: { name: string; url: string }[] = [];
      const failed: string[] = [];
      for (const f of files) {
        const info = await getFileByToken(f.token).catch(() => null);
        if (info?.success && info.signedUrl) {
          items.push({ name: f.name, url: info.signedUrl });
        } else {
          failed.push(f.name);
        }
      }
      const result = await downloadAllAsZip(items, 'syncflow-received-files.zip', (done) =>
        setZipProgress({ done: done + failed.length, total: files.length })
      );
      failed.push(...result.failed);
      if (failed.length > 0) {
        setDownloadError(
          result.ok === 0
            ? 'None of the files could be downloaded. They may have expired.'
            : `Couldn't include ${failed.length} of ${files.length}: ${failed.join(', ')}`
        );
      }
    } catch {
      setDownloadError('Download failed. Please try again.');
    } finally {
      setDownloading(null);
      setZipProgress(null);
    }
  }, [files]);

  const extendSession = async () => {
    if (!session) return;
    setExtending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/receive/${session.token}/extend`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setDeadline(data.expiresIn);
        setStatus('waiting');
      } else {
        if (response.status === 404 || response.status === 410) setCanExtend(false);
        setNotice(data.error || 'Couldn’t extend this session. Start a new one.');
      }
    } catch {
      setNotice('Couldn’t reach the server. Check your connection.');
    } finally {
      setExtending(false);
    }
  };

  const clearList = () => {
    setFiles([]);
    setDownloadError(null);
  };

  const whereFilesGo = session?.signedIn
    ? 'Also saved to My Files.'
    : `Files are kept for ${GUEST_RECEIVED_FILE_TTL_HOURS} hours — download them.`;

  // Loading state (first load — afterwards the received list stays on screen)
  if (status === 'loading' && files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <LoadingSpinner size="lg" className="text-brand-text" />
        <p className="mt-4 text-sm text-fg-muted">Creating receive session...</p>
      </div>
    );
  }

  // Error state (only when there is nothing received to keep showing)
  if (status === 'error' && files.length === 0) {
    return (
      <div className="max-w-md mx-auto py-10 text-center animate-fade-in">
        <span className="inline-flex w-16 h-16 mb-4 rounded-3xl bg-danger/10 text-danger-text items-center justify-center">
          <AlertCircle className="w-8 h-8" />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">Something went wrong</h1>
        <p className="text-sm text-fg-muted mb-6">{error}</p>
        <Button variant="primary" size="lg" onClick={startSession}>
          Try Again
        </Button>
      </div>
    );
  }

  const host = session ? session.codeUrl.replace(/^https?:\/\//, '') : '';

  return (
    <div className="max-w-md mx-auto py-8 animate-fade-in">
      <div className="text-center mb-6">
        <p className="label-mono mb-3">Receive on this computer</p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2">
          Phone → PC
        </h1>
        <p className="text-sm text-fg-muted">
          Scan the QR code with your phone to send files or text to this computer
        </p>
      </div>

      {/* Received files — kept after the session ends, until cleared */}
      {files.length > 0 && (
        <div className="border-flow rounded-3xl p-5 mb-4 shadow-[var(--shadow-card)] animate-fade-in">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-sm font-semibold text-fg flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-success-text" />
              {files.length} {files.length === 1 ? 'item' : 'items'} received
            </p>
            <div className="flex items-center gap-3">
              {files.length > 1 && (
                <button
                  type="button"
                  onClick={downloadAll}
                  disabled={downloading !== null}
                  className="flex items-center gap-1.5 text-xs font-medium text-brand-text hover:underline cursor-pointer disabled:opacity-50"
                >
                  {downloading === 'all' ? (
                    <LoadingSpinner size="sm" className="text-brand-text" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  {zipProgress ? `${zipProgress.done} / ${zipProgress.total}` : 'Download all'}
                </button>
              )}
              {status !== 'waiting' && (
                <button
                  type="button"
                  onClick={clearList}
                  disabled={downloading !== null}
                  className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg cursor-pointer disabled:opacity-50"
                  title="Clear this list (files are not deleted)"
                >
                  <X className="w-3.5 h-3.5" />
                  Clear
                </button>
              )}
            </div>
          </div>
          {downloadError && (
            <p
              role="alert"
              className="mb-3 p-2.5 text-xs bg-danger/10 border border-danger/20 text-danger-text rounded-xl"
            >
              {downloadError}
            </p>
          )}
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.token} className="p-2.5 bg-surface-2 border border-edge rounded-xl">
                <div className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-fg truncate" title={f.name}>
                      {f.name}
                    </span>
                    <span className="block text-[10px] text-fg-muted">{formatFileSize(f.size)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadOne(f)}
                    disabled={downloading !== null}
                    className="p-2 rounded-lg text-brand-text hover:bg-brand/10 cursor-pointer disabled:opacity-50"
                    title={`Download ${f.name}`}
                    aria-label={`Download ${f.name}`}
                  >
                    {downloading === f.token ? (
                      <LoadingSpinner size="sm" className="text-brand-text" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {isInlineText(f) && <TextPreview text={texts[f.token]} />}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-fg-faint text-center">{whereFilesGo}</p>
        </div>
      )}

      {status === 'waiting' && session ? (
        <div className="bg-surface border border-edge rounded-3xl p-6 shadow-[var(--shadow-card)]">
          {/* QR Code — gradient frame */}
          <div className="flex justify-center mb-3">
            <div className="p-[2px] bg-flow rounded-2xl glow-dot">
              <div className="p-4 bg-white rounded-[calc(1rem-2px)]">
                <QRCodeSVG value={session.sendUrl} size={200} level="M" includeMargin={false} />
              </div>
            </div>
          </div>

          {/* Fallbacks when the QR can't be scanned */}
          <div className="flex justify-center mb-4">
            <CopyButton text={session.sendUrl} />
          </div>
          {session.code && (
            <div className="mb-4 p-3 bg-surface-2 border border-edge rounded-xl text-center">
              <p className="text-xs text-fg-muted">
                No camera? On your phone, open <span className="font-medium text-fg">{host}</span> and enter
              </p>
              <p
                className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-fg select-all"
                aria-label={`Code ${session.code.split('').join(' ')}`}
              >
                {session.code.slice(0, 3)} {session.code.slice(3)}
              </p>
            </div>
          )}

          {/* Timer */}
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className={`w-2 h-2 rounded-full animate-pulse ${timeRemaining > 60 ? 'bg-success' : 'bg-warning'}`} />
            <span className="text-sm text-fg-muted">
              Expires in <span className="font-mono font-medium text-fg">{formatTime(timeRemaining)}</span>
            </span>
            {timeRemaining <= 300 && canExtend && (
              <button
                type="button"
                onClick={extendSession}
                disabled={extending}
                className="text-xs font-medium text-brand-text hover:underline cursor-pointer disabled:opacity-50"
              >
                {extending ? 'Extending…' : 'Extend 10 min'}
              </button>
            )}
          </div>
          {notice && <p className="-mt-2 mb-3 text-xs text-center text-danger-text">{notice}</p>}

          {/* Status */}
          {reconnecting ? (
            <div className="flex items-center justify-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-xl">
              <WifiOff className="w-4 h-4 text-warning-text" />
              <span className="text-sm text-warning-text font-medium">Reconnecting…</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 p-3 bg-brand/5 border border-brand/15 rounded-xl">
              <LoadingSpinner size="sm" className="text-brand-text" />
              <span className="text-sm text-brand-text font-medium">
                {files.length > 0 ? 'Listening for more…' : 'Waiting for files...'}
              </span>
            </div>
          )}
          {files.length === 0 && <p className="mt-2 text-[11px] text-fg-faint text-center">{whereFilesGo}</p>}

          {/* Instructions */}
          <div className="mt-4 pt-4 border-t border-edge">
            <p className="label-mono text-center mb-3">How it works</p>
            <ol className="text-xs text-fg-muted space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="font-mono text-fg-faint">1.</span>
                <span>Scan the QR code with your phone camera</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-fg-faint">2.</span>
                <span>Pick files or paste text — sending starts right away</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-fg-faint">3.</span>
                <span>Each item shows up here as it arrives</span>
              </li>
            </ol>
          </div>
        </div>
      ) : status === 'loading' ? (
        <div className="flex items-center justify-center gap-2 p-6 bg-surface border border-edge rounded-3xl">
          <LoadingSpinner size="sm" className="text-brand-text" />
          <span className="text-sm text-fg-muted">Creating receive session...</span>
        </div>
      ) : (
        // Session ended (or a new one failed) — the list above stays put.
        <div className="bg-surface border border-edge rounded-3xl p-6 text-center shadow-[var(--shadow-card)]">
          <span className="inline-flex w-12 h-12 mb-3 rounded-2xl bg-surface-2 border border-edge text-fg-faint items-center justify-center">
            {status === 'error' ? <AlertCircle className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
          </span>
          <h2 className="font-display text-lg font-bold tracking-tight text-fg mb-1">
            {status === 'error' ? 'Couldn’t start a session' : 'Session ended'}
          </h2>
          <p className="text-sm text-fg-muted mb-5">
            {status === 'error'
              ? error
              : files.length > 0
                ? 'Your phone can no longer send here. Received items stay above.'
                : 'Your phone can no longer send here.'}
          </p>
          {status === 'expired' && listeningLate && (
            <p className="-mt-3 mb-5 flex items-center justify-center gap-1.5 text-xs text-fg-faint">
              <LoadingSpinner size="sm" className="text-fg-faint" />
              Items that were still uploading will appear above.
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            {status === 'expired' && canExtend && (
              <Button variant="primary" size="md" onClick={extendSession} loading={extending} loadingText="Extending…">
                Extend 10 min
              </Button>
            )}
            <Button
              variant={status === 'expired' && canExtend ? 'secondary' : 'primary'}
              size="md"
              onClick={startSession}
            >
              New session
            </Button>
          </div>
          {notice && <p className="mt-3 text-xs text-danger-text">{notice}</p>}
        </div>
      )}

      <div className="mt-4 text-center">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
