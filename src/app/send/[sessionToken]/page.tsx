'use client';

import { useState, useRef, use } from 'react';
import { formatFileSize } from '@/lib/utils';
import LoadingSpinner from '@/components/LoadingSpinner';

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-xl p-6 shadow-sm text-center animate-fade-in">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">File Sent!</h1>
          <p className="text-sm text-gray-600 mb-4">
            Your file has been sent to the computer. You can close this page.
          </p>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-sm font-medium text-gray-700 truncate">{file?.name}</p>
            <p className="text-xs text-gray-500">{file ? formatFileSize(file.size) : ''}</p>
          </div>
        </div>
      </div>
    );
  }

  // Expired state
  if (status === 'expired') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-xl p-6 shadow-sm text-center animate-fade-in">
          <div className="text-6xl mb-4">⏰</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Session Expired</h1>
          <p className="text-sm text-gray-600">
            This upload link has expired. Please scan a new QR code from the computer.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-sm w-full animate-fade-in">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">📲</div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">Send to Computer</h1>
          <p className="text-sm text-gray-600">
            Select a file to send it to your computer instantly
          </p>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm">
          {/* File input */}
          <div
            className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
              file ? 'border-green-300 bg-green-50' : 'border-gray-300'
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
              <div className="space-y-2">
                <div className="text-4xl">
                  {file.type.startsWith('image/') ? '🖼️' : '📄'}
                </div>
                <p className="font-medium text-gray-900 text-sm truncate px-2">
                  {file.name}
                </p>
                <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-4xl">📁</div>
                <p className="text-sm text-gray-600 font-medium">Tap to select a file</p>
                <p className="text-xs text-gray-400">Maximum 50MB</p>
              </div>
            )}
          </div>

          {/* Progress bar */}
          {status === 'uploading' && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Uploading...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          {/* Buttons */}
          <div className="mt-4 space-y-2">
            {file && status !== 'uploading' && (
              <button
                onClick={handleUpload}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                Send to Computer
              </button>
            )}

            {status === 'uploading' && (
              <button
                disabled
                className="w-full py-3 bg-gray-400 text-white font-medium rounded-lg cursor-not-allowed flex items-center justify-center gap-2"
              >
                <LoadingSpinner size="sm" className="text-white" />
                <span>Sending...</span>
              </button>
            )}

            {file && status !== 'uploading' && (
              <button
                onClick={handleReset}
                className="w-full py-2.5 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors cursor-pointer text-sm"
              >
                Choose Different File
              </button>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-gray-400 text-center">
          File will appear on your computer automatically
        </p>
      </div>
    </div>
  );
}
