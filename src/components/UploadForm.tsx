'use client';

import { useState, useRef, useMemo } from 'react';
import { formatFileSize } from '@/lib/utils';
import { UploadProgress } from '@/types';
import {
  generateKey,
  exportKey,
  encryptFile,
  isEncryptionSupported,
} from '@/lib/crypto';
import CopyButton from './CopyButton';
import LoadingSpinner from './LoadingSpinner';
import ProgressBar from './ProgressBar';
import QRModal from './QRModal';

const ALLOWED_TYPES_TEXT = 'All file types supported';
const MAX_SIZE_TEXT = 'Maximum file size: 50MB';

const EXPIRY_OPTIONS = [
  { value: '', label: 'Never expires' },
  { value: '1', label: '1 hour' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
];

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Phase 2 state
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    stage: 'idle',
    percent: 0,
  });
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  const encryptionSupported = useMemo(() => isEncryptionSupported(), []);
  const [expiryHours, setExpiryHours] = useState<string>('');
  const [maxDownloads, setMaxDownloads] = useState<string>('');
  const [showQRModal, setShowQRModal] = useState(false);
  const [fileName, setFileName] = useState<string>('');

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setShareUrl(null);
      setError(null);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setShareUrl(null);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);
    setUploadProgress({ stage: 'preparing', percent: 5 });

    try {
      let fileData: ArrayBuffer | Blob = file;
      let encryptionKey: string | null = null;
      const shouldEncrypt = encryptionEnabled && encryptionSupported;

      // Encrypt file if enabled
      if (shouldEncrypt) {
        setUploadProgress({ stage: 'encrypting', percent: 10 });

        const key = await generateKey();
        encryptionKey = await exportKey(key);

        const fileArrayBuffer = await file.arrayBuffer();
        setUploadProgress({ stage: 'encrypting', percent: 30 });

        const encryptedData = await encryptFile(fileArrayBuffer, key);
        setUploadProgress({ stage: 'encrypting', percent: 50 });

        fileData = new Blob([encryptedData], { type: 'application/octet-stream' });
      }

      setUploadProgress({ stage: 'uploading', percent: shouldEncrypt ? 55 : 10 });

      // Create form data
      const formData = new FormData();
      formData.append('file', fileData);
      formData.append('originalName', file.name);
      formData.append('mimeType', file.type || 'application/octet-stream');
      formData.append('isEncrypted', shouldEncrypt ? 'true' : 'false');
      if (expiryHours) {
        formData.append('expiresInHours', expiryHours);
      }
      if (maxDownloads) {
        formData.append('maxDownloads', maxDownloads);
      }

      // Upload with XHR for progress tracking
      const result = await uploadWithProgress(formData, (progress) => {
        const basePercent = shouldEncrypt ? 55 : 10;
        const uploadPercent = basePercent + (progress * (95 - basePercent) / 100);
        setUploadProgress({
          stage: 'uploading',
          percent: uploadPercent,
          bytesUploaded: Math.round((progress / 100) * (fileData instanceof Blob ? fileData.size : file.size)),
          totalBytes: fileData instanceof Blob ? fileData.size : file.size,
        });
      });

      if (result.success && result.shareUrl) {
        setUploadProgress({ stage: 'completed', percent: 100 });

        // Append encryption key to URL fragment if encrypted
        const finalUrl = encryptionKey
          ? `${result.shareUrl}#${encryptionKey}`
          : result.shareUrl;

        setShareUrl(finalUrl);
        setFileName(file.name);
      } else {
        setUploadProgress({ stage: 'error', percent: 0 });
        setError(result.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Upload error:', err);
      setUploadProgress({ stage: 'error', percent: 0 });
      setError('An unexpected error occurred');
    }

    setUploading(false);
  };

  const uploadWithProgress = (
    formData: FormData,
    onProgress: (percent: number) => void
  ): Promise<{ success: boolean; shareUrl?: string; error?: string }> => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      });

      xhr.addEventListener('load', () => {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch {
          resolve({ success: false, error: 'Invalid response from server' });
        }
      });

      xhr.addEventListener('error', () => {
        resolve({ success: false, error: 'Network error occurred' });
      });

      xhr.addEventListener('abort', () => {
        resolve({ success: false, error: 'Upload was cancelled' });
      });

      xhr.open('POST', '/api/upload');
      xhr.send(formData);
    });
  };

  const handleReset = () => {
    setFile(null);
    setShareUrl(null);
    setError(null);
    setUploadProgress({ stage: 'idle', percent: 0 });
    setExpiryHours('');
    setMaxDownloads('');
    setFileName('');
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const isActiveUpload = uploadProgress.stage !== 'idle' && uploadProgress.stage !== 'error' && uploading;

  return (
    <div className="w-full max-w-xl mx-auto px-4 sm:px-0">
      {!shareUrl ? (
        <div className="animate-fade-in">
          <div
            className={`relative border-2 border-dashed rounded-xl p-6 sm:p-8 md:p-10 text-center transition-all duration-300 ease-out ${
              dragActive
                ? 'border-blue-500 bg-blue-50 scale-[1.02]'
                : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              type="file"
              onChange={handleChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Select a file to upload"
              disabled={uploading}
            />

            {file ? (
              <div className="space-y-2 sm:space-y-3 animate-fade-in-scale">
                <div className="text-4xl sm:text-5xl md:text-6xl">
                  {file.type.startsWith('image/') ? '🖼️' : '📄'}
                </div>
                <p className="font-medium text-gray-900 truncate text-sm sm:text-base px-2">
                  {file.name}
                </p>
                <p className="text-xs sm:text-sm text-gray-500">
                  {formatFileSize(file.size)}
                </p>
                <p className="text-xs text-green-600 mt-1">
                  Ready to upload
                </p>
              </div>
            ) : (
              <div className="space-y-2 sm:space-y-3">
                <div className="text-4xl sm:text-5xl md:text-6xl">📁</div>
                <p className="text-gray-600 text-sm sm:text-base font-medium">
                  Drag and drop a file here
                </p>
                <p className="text-xs sm:text-sm text-gray-400">
                  or click anywhere in this area to browse
                </p>
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-3 text-xs text-gray-400">
                  <span>{ALLOWED_TYPES_TEXT}</span>
                  <span className="hidden sm:inline">•</span>
                  <span>{MAX_SIZE_TEXT}</span>
                </div>
              </div>
            )}
          </div>

          {/* Upload Options */}
          {file && !uploading && (
            <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-4 animate-fade-in">
              {/* Encryption Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">End-to-end encryption</span>
                  {encryptionEnabled && encryptionSupported && (
                    <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Secure</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEncryptionEnabled(!encryptionEnabled)}
                  disabled={!encryptionSupported}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                    encryptionEnabled && encryptionSupported
                      ? 'bg-blue-600'
                      : 'bg-gray-300'
                  } ${!encryptionSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
                  aria-label="Toggle encryption"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      encryptionEnabled && encryptionSupported ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {!encryptionSupported && (
                <p className="text-xs text-amber-600">
                  Encryption not supported in this browser
                </p>
              )}

              {/* Expiry Dropdown */}
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="expiry" className="text-sm font-medium text-gray-700">
                  Link expiration
                </label>
                <select
                  id="expiry"
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(e.target.value)}
                  className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg bg-white text-gray-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {EXPIRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Max Downloads */}
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="maxDownloads" className="text-sm font-medium text-gray-700">
                  Max downloads
                </label>
                <input
                  id="maxDownloads"
                  type="number"
                  min="1"
                  max="1000"
                  placeholder="Unlimited"
                  value={maxDownloads}
                  onChange={(e) => setMaxDownloads(e.target.value)}
                  className="w-28 text-sm px-3 py-1.5 border border-gray-300 rounded-lg bg-white text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Progress Bar */}
          {isActiveUpload && (
            <div className="mt-4 animate-fade-in">
              <ProgressBar
                stage={uploadProgress.stage}
                percent={uploadProgress.percent}
              />
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg animate-fade-in">
              <p className="text-xs sm:text-sm text-red-600 font-medium">{error}</p>
              <p className="text-xs text-red-500 mt-1">
                Please try again or choose a different file.
              </p>
            </div>
          )}

          <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row gap-2 sm:gap-3">
            {file && (
              <button
                onClick={handleReset}
                disabled={uploading}
                className={`w-full sm:flex-1 px-4 py-2.5 sm:py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 cursor-pointer btn-hover transition-colors duration-200 text-sm sm:text-base font-medium ${
                  uploading ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                title="Remove selected file and start over"
              >
                Clear
              </button>
            )}
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className={`w-full sm:flex-1 px-4 py-2.5 sm:py-3 rounded-lg text-white font-medium text-sm sm:text-base transition-all duration-200 flex items-center justify-center gap-2 ${
                !file || uploading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 cursor-pointer btn-hover'
              }`}
              title={!file ? 'Select a file first' : 'Upload file and generate share link'}
            >
              {uploading ? (
                <>
                  <LoadingSpinner size="sm" className="text-white" />
                  <span>
                    {uploadProgress.stage === 'encrypting'
                      ? 'Encrypting...'
                      : uploadProgress.stage === 'uploading'
                      ? 'Uploading...'
                      : 'Preparing...'}
                  </span>
                </>
              ) : (
                'Upload & Share'
              )}
            </button>
          </div>

          {!file && (
            <p className="mt-4 text-xs text-center text-gray-400">
              Your file will be securely stored and a unique link will be generated for sharing.
            </p>
          )}
        </div>
      ) : (
        <div className="border border-green-200 bg-green-50 rounded-xl p-5 sm:p-6 md:p-8 text-center animate-fade-in-scale">
          <div className="text-4xl sm:text-5xl mb-3 sm:mb-4">✅</div>
          <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">
            File uploaded successfully!
          </h3>
          <p className="text-xs sm:text-sm text-gray-600 mb-4 sm:mb-6">
            Share this link with anyone to let them download your file.
            <br />
            <span className="text-gray-500">No account required to download.</span>
          </p>

          {encryptionEnabled && encryptionSupported && (
            <div className="mb-4 flex items-center justify-center gap-2 text-xs text-purple-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>End-to-end encrypted - key is in the link</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 p-3 sm:p-4 bg-white border border-gray-200 rounded-lg">
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="flex-1 text-xs sm:text-sm text-gray-700 bg-transparent outline-none truncate text-center sm:text-left py-2 sm:py-0"
              aria-label="Share link"
            />
            <div className="flex gap-2">
              <CopyButton text={shareUrl} />
              <button
                onClick={() => setShowQRModal(true)}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors cursor-pointer flex items-center gap-1.5"
                title="Show QR Code"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                <span className="hidden sm:inline">QR</span>
              </button>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            Tip: Sign in to manage your uploads and track download activity.
          </p>

          <button
            onClick={handleReset}
            className="mt-4 sm:mt-6 text-sm text-blue-600 hover:text-blue-700 cursor-pointer transition-colors duration-200 font-medium"
          >
            Upload another file
          </button>
        </div>
      )}

      {/* QR Modal */}
      <QRModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        url={shareUrl || ''}
        fileName={fileName}
      />
    </div>
  );
}
