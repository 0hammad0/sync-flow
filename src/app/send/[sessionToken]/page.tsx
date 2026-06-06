'use client';

import { useState, useRef, use } from 'react';
import { formatFileSize } from '@/lib/utils';
import LoadingSpinner from '@/components/LoadingSpinner';
import Button from '@/components/ui/Button';
import {
  CheckCircle2,
  Clock,
  FileText,
  Image as ImageIcon,
  MonitorSmartphone,
  UploadCloud,
} from 'lucide-react';

interface SendPageProps {
  params: Promise<{ sessionToken: string }>;
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error' | 'expired';

export default function SendPage({ params }: SendPageProps) {
  const { sessionToken } = use(params);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setStatus('uploading');
    setProgress(0);
    setError(null);

    try {
      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('originalName', file.name);
      formData.append('mimeType', file.type || 'application/octet-stream');
      formData.append('isEncrypted', 'false');
      formData.append('sessionToken', sessionToken);

      // Upload with XHR for progress
      const result = await new Promise<{ success: boolean; token?: string; error?: string }>((resolve) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch {
            resolve({ success: false, error: 'Invalid server response' });
          }
        });

        xhr.addEventListener('error', () => {
          resolve({ success: false, error: 'Network error' });
        });

        xhr.open('POST', '/api/send');
        xhr.send(formData);
      });

      if (result.success) {
        setStatus('success');
      } else if (result.error === 'Session expired') {
        setStatus('expired');
      } else {
        setError(result.error || 'Upload failed');
        setStatus('error');
      }
    } catch {
      setError('An unexpected error occurred');
      setStatus('error');
    }
  };

  const handleReset = () => {
    setFile(null);
    setStatus('idle');
    setProgress(0);
    setError(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  // Success state
  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm w-full border-flow rounded-3xl p-6 text-center animate-fade-in shadow-[var(--shadow-card)]">
          <span className="inline-flex w-16 h-16 mb-4 rounded-full bg-flow text-white items-center justify-center glow-dot animate-pop-in">
            <CheckCircle2 className="w-8 h-8" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">File Sent!</h1>
          <p className="text-sm text-fg-muted mb-4">
            Your file has been sent to the computer. You can close this page.
          </p>
          <div className="p-3 bg-surface-2 border border-edge rounded-2xl">
            <p className="text-sm font-medium text-fg truncate">{file?.name}</p>
            <p className="text-xs text-fg-muted">{file ? formatFileSize(file.size) : ''}</p>
          </div>
        </div>
      </div>
    );
  }

  // Expired state
  if (status === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-surface border border-edge rounded-3xl p-6 text-center animate-fade-in">
          <span className="inline-flex w-16 h-16 mb-4 rounded-3xl bg-surface-2 border border-edge text-fg-faint items-center justify-center">
            <Clock className="w-8 h-8" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">Session Expired</h1>
          <p className="text-sm text-fg-muted">
            This upload link has expired. Please scan a new QR code from the computer.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm w-full animate-fade-in">
        <div className="text-center mb-6">
          <span className="inline-flex w-12 h-12 mb-3 rounded-2xl bg-brand/10 text-brand-text items-center justify-center">
            <MonitorSmartphone className="w-6 h-6" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-1">Send to Computer</h1>
          <p className="text-sm text-fg-muted">
            Select a file to send it to your computer instantly
          </p>
        </div>

        <div className="bg-surface border border-edge rounded-3xl p-5 shadow-[var(--shadow-card)]">
          {/* File input */}
          <div
            className={`relative border-2 border-dashed rounded-2xl p-6 text-center transition-colors ${
              file ? 'border-success/40 bg-success/5' : 'border-edge-strong'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              onChange={handleChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={status === 'uploading'}
            />

            {file ? (
              <div className="space-y-2 animate-fade-in-scale">
                <span className="inline-flex w-12 h-12 rounded-2xl bg-flow text-white items-center justify-center">
                  {file.type.startsWith('image/') ? (
                    <ImageIcon className="w-6 h-6" />
                  ) : (
                    <FileText className="w-6 h-6" />
                  )}
                </span>
                <p className="font-medium text-fg text-sm truncate px-2">
                  {file.name}
                </p>
                <p className="text-xs text-fg-muted">{formatFileSize(file.size)}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <span className="inline-flex w-12 h-12 rounded-2xl bg-brand/10 text-brand-text items-center justify-center animate-float">
                  <UploadCloud className="w-6 h-6" />
                </span>
                <p className="text-sm text-fg font-medium">Tap to select a file</p>
                <p className="text-xs text-fg-faint">Maximum 100MB</p>
              </div>
            )}
          </div>

          {/* Progress bar */}
          {status === 'uploading' && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-fg-muted mb-1">
                <span>Uploading...</span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <div className="w-full bg-surface-3 rounded-full h-2 overflow-hidden">
                <div
                  className="relative bg-flow h-2 rounded-full transition-all duration-300 overflow-hidden progress-shimmer"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-danger/10 border border-danger/20 rounded-xl">
              <p className="text-xs text-danger-text">{error}</p>
            </div>
          )}

          {/* Buttons */}
          <div className="mt-4 space-y-2">
            {file && status !== 'uploading' && (
              <Button variant="primary" size="lg" fullWidth onClick={handleUpload}>
                Send to Computer
              </Button>
            )}

            {status === 'uploading' && (
              <button
                disabled
                className="w-full py-3 bg-surface-3 text-fg-faint font-medium rounded-xl cursor-not-allowed flex items-center justify-center gap-2"
              >
                <LoadingSpinner size="sm" className="text-fg-faint" />
                <span>Sending...</span>
              </button>
            )}

            {file && status !== 'uploading' && (
              <Button variant="secondary" size="md" fullWidth onClick={handleReset}>
                Choose Different File
              </Button>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-fg-faint text-center">
          File will appear on your computer automatically
        </p>
      </div>
    </div>
  );
}
