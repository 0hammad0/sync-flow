'use client';

import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { formatFileSize } from '@/lib/utils';
import LoadingSpinner from '@/components/LoadingSpinner';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, Lock } from 'lucide-react';

interface FileInfo {
  name: string;
  size: number;
  mimeType: string;
  token: string;
  isEncrypted: boolean;
}

type SessionStatus = 'loading' | 'waiting' | 'completed' | 'expired' | 'error';

export default function ReceivePage() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sendUrl, setSendUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [file, setFile] = useState<FileInfo | null>(null);
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

  // Poll for file upload
  const checkStatus = useCallback(async () => {
    if (!sessionToken || status !== 'waiting') return;

    try {
      const response = await fetch(`/api/receive/${sessionToken}`);
      const data = await response.json();

      if (data.success) {
        if (data.status === 'completed' && data.file) {
          setFile(data.file);
          setStatus('completed');
        }
      } else if (response.status === 410) {
        setStatus('expired');
      }
    } catch {
      // Silently fail on poll errors
    }
  }, [sessionToken, status]);

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
    setFile(null);
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

  // Completed state
  if (status === 'completed' && file) {
    return (
      <div className="max-w-md mx-auto py-8 animate-fade-in">
        <div className="border-flow rounded-3xl p-6 text-center shadow-[var(--shadow-card)]">
          <span className="inline-flex w-16 h-16 mb-4 rounded-full bg-flow text-white items-center justify-center glow-dot animate-pop-in">
            <CheckCircle2 className="w-8 h-8" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">File Received!</h1>
          <p className="text-sm text-fg-muted mb-4">
            Your file has been uploaded successfully.
          </p>

          <div className="bg-surface-2 border border-edge rounded-2xl p-4 mb-4">
            <p className="font-medium text-fg truncate" title={file.name}>
              {file.name}
            </p>
            <p className="text-sm text-fg-muted">{formatFileSize(file.size)}</p>
            {file.isEncrypted && (
              <span className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 bg-brand/10 text-brand-text text-xs rounded-full font-medium">
                <Lock className="w-3 h-3" />
                Encrypted
              </span>
            )}
          </div>

          <Button href={`/share/${file.token}`} variant="primary" size="lg" fullWidth>
            Download File
          </Button>

          <button
            onClick={handleNewSession}
            className="mt-4 text-sm text-brand-text hover:underline cursor-pointer font-medium"
          >
            Receive another file
          </button>
        </div>
      </div>
    );
  }

  // Waiting state - show QR code
  return (
    <div className="max-w-md mx-auto py-8 animate-fade-in">
      <div className="text-center mb-6">
        <p className="label-mono mb-3">Phone → PC</p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2">
          Receive from Phone
        </h1>
        <p className="text-sm text-fg-muted">
          Scan this QR code with your phone to send a file to this device
        </p>
      </div>

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
          <span className="text-sm text-brand-text font-medium">Waiting for file...</span>
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
              <span>Select a file and it will appear here automatically</span>
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
