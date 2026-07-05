'use client';

import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { formatFileSize } from '@/lib/utils';
import { getFileByToken } from '@/actions/files';
import { downloadAllAsZip } from '@/lib/zip';
import LoadingSpinner from '@/components/LoadingSpinner';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, Download } from 'lucide-react';

interface FileInfo {
  name: string;
  size: number;
  mimeType: string;
  token: string;
  isEncrypted: boolean;
}

type SessionStatus = 'loading' | 'waiting' | 'expired' | 'error';

export default function ReceivePage() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sendUrl, setSendUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(600);
  const [error, setError] = useState<string | null>(null);

  // Create session on mount
  useEffect(() => {
    const createSession = async () => {
      try {
        const response = await fetch('/api/receive', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
          setSessionToken(data.sessionToken);
          setSendUrl(data.sendUrl);
          setTimeRemaining(data.expiresIn);
          setStatus('waiting');
        } else {
          setError(data.error);
          setStatus('error');
        }
      } catch {
        setError('Failed to create receive session');
        setStatus('error');
      }
    };

    createSession();
  }, []);

  // Poll for uploads — the session keeps accepting files until it expires,
  // so polling continues after the first arrival and the list grows live.
  const checkStatus = useCallback(async () => {
    if (!sessionToken || status !== 'waiting') return;

    try {
      const response = await fetch(`/api/receive/${sessionToken}`);
      const data = await response.json();

      if (data.success) {
        if (Array.isArray(data.files)) setFiles(data.files);
      } else if (response.status === 410) {
        setStatus('expired');
      }
    } catch {
      // Silently fail on poll errors
    }
  }, [sessionToken, status]);

  // Direct download via a fresh signed URL (files from the phone are
  // unencrypted, so Content-Disposition triggers a plain download).
  const downloadOne = useCallback(async (token: string) => {
    setDownloading(token);
    try {
      const info = await getFileByToken(token);
      if (info.success && info.signedUrl) {
        const link = document.createElement('a');
        link.href = info.signedUrl;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } finally {
      setDownloading(null);
    }
  }, []);

  // Browsers block programmatic downloads after the first click, so the
  // files are fetched and bundled into one zip instead of clicked one by one.
  const downloadAll = useCallback(async () => {
    setDownloading('all');
    try {
      const items: { name: string; url: string }[] = [];
      for (const f of files) {
        const info = await getFileByToken(f.token);
        if (info.success && info.signedUrl) {
          items.push({ name: f.name, url: info.signedUrl });
        }
      }
      await downloadAllAsZip(items, 'syncflow-received-files.zip');
    } finally {
      setDownloading(null);
    }
  }, [files]);

  // Poll every 2 seconds
  useEffect(() => {
    if (status !== 'waiting') return;

    const pollInterval = setInterval(checkStatus, 2000);
    return () => clearInterval(pollInterval);
  }, [status, checkStatus]);

  // Countdown timer
  useEffect(() => {
    if (status !== 'waiting' || timeRemaining <= 0) return;

    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setStatus('expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [status, timeRemaining]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleNewSession = () => {
    setStatus('loading');
    setSessionToken(null);
    setSendUrl(null);
    setFiles([]);
    setError(null);

    // Create new session
    fetch('/api/receive', { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setSessionToken(data.sessionToken);
          setSendUrl(data.sendUrl);
          setTimeRemaining(data.expiresIn);
          setStatus('waiting');
        } else {
          setError(data.error);
          setStatus('error');
        }
      })
      .catch(() => {
        setError('Failed to create receive session');
        setStatus('error');
      });
  };

  // Loading state
  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <LoadingSpinner size="lg" className="text-brand-text" />
        <p className="mt-4 text-sm text-fg-muted">Creating receive session...</p>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="max-w-md mx-auto py-10 text-center animate-fade-in">
        <span className="inline-flex w-16 h-16 mb-4 rounded-3xl bg-danger/10 text-danger-text items-center justify-center">
          <AlertCircle className="w-8 h-8" />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">Something went wrong</h1>
        <p className="text-sm text-fg-muted mb-6">{error}</p>
        <Button variant="primary" size="lg" onClick={handleNewSession}>
          Try Again
        </Button>
      </div>
    );
  }

  // Expired state
  if (status === 'expired') {
    return (
      <div className="max-w-md mx-auto py-10 text-center animate-fade-in">
        <span className="inline-flex w-16 h-16 mb-4 rounded-3xl bg-surface-2 border border-edge text-fg-faint items-center justify-center">
          <Clock className="w-8 h-8" />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">Session Expired</h1>
        <p className="text-sm text-fg-muted mb-6">
          The receive session has timed out. Create a new one to continue.
        </p>
        <Button variant="primary" size="lg" onClick={handleNewSession}>
          Create New Session
        </Button>
      </div>
    );
  }

  // Waiting state - show QR code (+ growing list of received files)
  return (
    <div className="max-w-md mx-auto py-8 animate-fade-in">
      <div className="text-center mb-6">
        <p className="label-mono mb-3">Phone → PC</p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2">
          Receive from Phone
        </h1>
        <p className="text-sm text-fg-muted">
          Scan this QR code with your phone to send files to this device
        </p>
      </div>

      {/* Received files — grows live while the session stays open */}
      {files.length > 0 && (
        <div className="border-flow rounded-3xl p-5 mb-4 shadow-[var(--shadow-card)] animate-fade-in">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-sm font-semibold text-fg flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-success-text" />
              {files.length} {files.length === 1 ? 'file' : 'files'} received
            </p>
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
                Download all
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {files.map((f) => (
              <li
                key={f.token}
                className="flex items-center gap-2.5 p-2.5 bg-surface-2 border border-edge rounded-xl"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-fg truncate" title={f.name}>
                    {f.name}
                  </span>
                  <span className="block text-[10px] text-fg-muted">{formatFileSize(f.size)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => downloadOne(f.token)}
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
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-fg-faint text-center">
            Keep sending from your phone — new files appear here automatically
          </p>
        </div>
      )}

      <div className="bg-surface border border-edge rounded-3xl p-6 shadow-[var(--shadow-card)]">
        {/* QR Code — gradient frame */}
        <div className="flex justify-center mb-4">
          <div className="p-[2px] bg-flow rounded-2xl glow-dot">
            <div className="p-4 bg-white rounded-[calc(1rem-2px)]">
              {sendUrl && (
                <QRCodeSVG
                  value={sendUrl}
                  size={200}
                  level="M"
                  includeMargin={false}
                />
              )}
            </div>
          </div>
        </div>

        {/* Timer */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className={`w-2 h-2 rounded-full animate-pulse ${timeRemaining > 60 ? 'bg-success' : 'bg-warning'}`} />
          <span className="text-sm text-fg-muted">
            Expires in <span className="font-mono font-medium text-fg">{formatTime(timeRemaining)}</span>
          </span>
        </div>

        {/* Status */}
        <div className="flex items-center justify-center gap-2 p-3 bg-brand/5 border border-brand/15 rounded-xl">
          <LoadingSpinner size="sm" className="text-brand-text" />
          <span className="text-sm text-brand-text font-medium">
            {files.length > 0 ? 'Listening for more files…' : 'Waiting for files...'}
          </span>
        </div>

        {/* Instructions */}
        <div className="mt-4 pt-4 border-t border-edge">
          <p className="label-mono text-center mb-3">How it works</p>
          <ol className="text-xs text-fg-muted space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="font-mono text-fg-faint">1.</span>
              <span>Open your phone camera</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono text-fg-faint">2.</span>
              <span>Point at the QR code above</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono text-fg-faint">3.</span>
              <span>Tap the link to open the upload page</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono text-fg-faint">4.</span>
              <span>Select one or more files — each appears here automatically</span>
            </li>
          </ol>
        </div>
      </div>

      <div className="mt-4 text-center">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
