'use client';

import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { formatFileSize } from '@/lib/utils';
import LoadingSpinner from '@/components/LoadingSpinner';
import Link from 'next/link';

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
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-sm text-gray-500">Creating receive session...</p>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="max-w-md mx-auto py-8 px-4 text-center animate-fade-in">
        <div className="text-5xl mb-4">❌</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
        <p className="text-sm text-gray-600 mb-6">{error}</p>
        <button
          onClick={handleNewSession}
          className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Expired state
  if (status === 'expired') {
    return (
      <div className="max-w-md mx-auto py-8 px-4 text-center animate-fade-in">
        <div className="text-5xl mb-4">⏰</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Session Expired</h1>
        <p className="text-sm text-gray-600 mb-6">
          The receive session has timed out. Create a new one to continue.
        </p>
        <button
          onClick={handleNewSession}
          className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
        >
          Create New Session
        </button>
      </div>
    );
  }

  // Completed state
  if (status === 'completed' && file) {
    return (
      <div className="max-w-md mx-auto py-8 px-4 animate-fade-in">
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">File Received!</h1>
          <p className="text-sm text-gray-600 mb-4">
            Your file has been uploaded successfully.
          </p>

          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
            <p className="font-medium text-gray-900 truncate" title={file.name}>
              {file.name}
            </p>
            <p className="text-sm text-gray-500">{formatFileSize(file.size)}</p>
            {file.isEncrypted && (
              <span className="inline-flex items-center gap-1 mt-2 px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Encrypted
              </span>
            )}
          </div>

          <Link
            href={`/share/${file.token}`}
            className="block w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors text-center"
          >
            Download File
          </Link>

          <button
            onClick={handleNewSession}
            className="mt-4 text-sm text-blue-600 hover:text-blue-700 cursor-pointer"
          >
            Receive another file
          </button>
        </div>
      </div>
    );
  }

  // Waiting state - show QR code
  return (
    <div className="max-w-md mx-auto py-8 px-4 animate-fade-in">
      <div className="text-center mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
          Receive from Phone
        </h1>
        <p className="text-sm text-gray-600">
          Scan this QR code with your phone to send a file to this device
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        {/* QR Code */}
        <div className="flex justify-center mb-4">
          <div className="p-4 bg-white border-2 border-gray-100 rounded-xl">
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

        {/* Timer */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className={`w-2 h-2 rounded-full animate-pulse ${timeRemaining > 60 ? 'bg-green-500' : 'bg-amber-500'}`} />
          <span className="text-sm text-gray-600">
            Expires in <span className="font-mono font-medium">{formatTime(timeRemaining)}</span>
          </span>
        </div>

        {/* Status */}
        <div className="flex items-center justify-center gap-2 p-3 bg-blue-50 rounded-lg">
          <LoadingSpinner size="sm" className="text-blue-600" />
          <span className="text-sm text-blue-700">Waiting for file...</span>
        </div>

        {/* Instructions */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-500 text-center mb-3">How it works:</p>
          <ol className="text-xs text-gray-500 space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="font-medium text-gray-700">1.</span>
              <span>Open your phone camera</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-medium text-gray-700">2.</span>
              <span>Point at the QR code above</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-medium text-gray-700">3.</span>
              <span>Tap the link to open the upload page</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-medium text-gray-700">4.</span>
              <span>Select a file and it will appear here automatically</span>
            </li>
          </ol>
        </div>
      </div>

      <div className="mt-4 text-center">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
