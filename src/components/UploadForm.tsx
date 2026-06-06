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
import Button from './ui/Button';
import {
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Lock,
  Mail,
  QrCode,
  UploadCloud,
} from 'lucide-react';

const ALLOWED_TYPES_TEXT = 'All file types supported';
const MAX_SIZE_TEXT = 'Maximum file size: 100MB';

// Guest options - limited
const GUEST_EXPIRY_OPTIONS = [
  { value: '1', label: '1 hour' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
];

// Full options for logged-in users
const USER_EXPIRY_OPTIONS = [
  { value: '', label: 'Never expires' },
  { value: '1', label: '1 hour' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
];

interface UploadFormProps {
  isAuthenticated?: boolean;
}

export default function UploadForm({ isAuthenticated = false }: UploadFormProps) {
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
  // Default to 24 hours for guests, empty (never) for logged-in users
  const [expiryHours, setExpiryHours] = useState<string>(isAuthenticated ? '' : '24');
  const expiryOptions = isAuthenticated ? USER_EXPIRY_OPTIONS : GUEST_EXPIRY_OPTIONS;
  const [maxDownloads, setMaxDownloads] = useState<string>('');
  const [showQRModal, setShowQRModal] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

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
    setExpiryHours(isAuthenticated ? '' : '24');
    setMaxDownloads('');
    setFileName('');
    setShowEmailForm(false);
    setRecipientEmail('');
    setEmailSent(false);
    setEmailSending(false);
    setEmailError(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleSendEmail = async () => {
    if (!recipientEmail || !shareUrl) return;

    setEmailSending(true);
    setEmailError(null);

    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipientEmail,
          fileName,
          downloadLink: shareUrl,
          isEncrypted: encryptionEnabled && encryptionSupported,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setEmailSent(true);
        setShowEmailForm(false);
        setRecipientEmail('');
      } else {
        setEmailError(result.error || 'Failed to send email');
      }
    } catch {
      setEmailError('Failed to send email. Please try again.');
    } finally {
      setEmailSending(false);
    }
  };

  const isActiveUpload = uploadProgress.stage !== 'idle' && uploadProgress.stage !== 'error' && uploading;

  return (
    <div className="w-full max-w-xl mx-auto">
      {!shareUrl ? (
        <div className="animate-fade-in">
          <div
            className={`relative rounded-3xl p-7 sm:p-9 md:p-11 text-center transition-all duration-300 ease-out ${
              dragActive
                ? 'border-beam scale-[1.02] shadow-[var(--glow)]'
                : 'border-2 border-dashed border-edge-strong bg-surface/60 hover:border-brand/50 hover:bg-surface shadow-[var(--shadow-card)]'
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
                <span className="inline-flex w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-flow text-white items-center justify-center glow-dot animate-pop-in">
                  {file.type.startsWith('image/') ? (
                    <ImageIcon className="w-8 h-8 sm:w-9 sm:h-9" />
                  ) : (
                    <FileText className="w-8 h-8 sm:w-9 sm:h-9" />
                  )}
                </span>
                <p className="font-semibold text-fg truncate text-sm sm:text-base px-2">
                  {file.name}
                </p>
                <p className="text-xs sm:text-sm text-fg-muted">
                  {formatFileSize(file.size)}
                </p>
                <p className="inline-flex items-center gap-1 text-xs text-success-text font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Ready to upload
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <span className="inline-flex w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-brand/10 text-brand-text items-center justify-center animate-float">
                  <UploadCloud className="w-8 h-8 sm:w-9 sm:h-9" />
                </span>
                <p className="text-fg text-sm sm:text-base font-semibold">
                  Drag and drop a file here
                </p>
                <p className="text-xs sm:text-sm text-fg-faint">
                  or click anywhere in this area to browse
                </p>
                <div className="pt-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-3 text-xs text-fg-faint">
                  <span>{ALLOWED_TYPES_TEXT}</span>
                  <span className="hidden sm:inline text-edge-strong">•</span>
                  <span>{MAX_SIZE_TEXT}</span>
                </div>
              </div>
            )}
          </div>

          {/* Upload Options */}
          {file && !uploading && (
            <div className="mt-4 p-4 sm:p-5 bg-surface border border-edge rounded-2xl space-y-4 animate-fade-in shadow-[var(--shadow-card)]">
              {/* Encryption Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Lock className="w-4 h-4 shrink-0 text-brand-text" />
                  <span className="text-sm font-medium text-fg">End-to-end encryption</span>
                  {encryptionEnabled && encryptionSupported && (
                    <span className="text-[10px] sm:text-xs px-2 py-0.5 bg-success/10 text-success-text rounded-full font-medium whitespace-nowrap">
                      Secure
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEncryptionEnabled(!encryptionEnabled)}
                  disabled={!encryptionSupported}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all duration-300 cursor-pointer ${
                    encryptionEnabled && encryptionSupported
                      ? 'bg-flow shadow-[var(--glow)]'
                      : 'bg-surface-3'
                  } ${!encryptionSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
                  aria-label="Toggle encryption"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-300 ${
                      encryptionEnabled && encryptionSupported ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {!encryptionSupported && (
                <p className="text-xs text-warning-text">
                  Encryption not supported in this browser
                </p>
              )}

              {/* Expiry Dropdown */}
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="expiry" className="text-sm font-medium text-fg">
                  Link expiration
                </label>
                <select
                  id="expiry"
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(e.target.value)}
                  className="input-base text-sm px-3 py-1.5 cursor-pointer"
                >
                  {expiryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {!isAuthenticated && (
                <p className="text-xs text-fg-faint">
                  <a href="/login" className="text-brand-text hover:underline font-medium">Sign in</a> for more expiration options (Never, 30 days)
                </p>
              )}

              {/* Max Downloads */}
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="maxDownloads" className="text-sm font-medium text-fg">
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
                  className="input-base w-28 text-sm px-3 py-1.5"
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
            <div className="mt-4 p-3 sm:p-4 bg-danger/10 border border-danger/20 rounded-2xl animate-fade-in">
              <p className="text-xs sm:text-sm text-danger-text font-medium">{error}</p>
              <p className="text-xs text-danger-text/80 mt-1">
                Please try again or choose a different file.
              </p>
            </div>
          )}

          <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row gap-2 sm:gap-3">
            {file && (
              <Button
                variant="secondary"
                size="lg"
                onClick={handleReset}
                disabled={uploading}
                className="w-full sm:flex-1"
                title="Remove selected file and start over"
              >
                Clear
              </Button>
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={handleUpload}
              disabled={!file || uploading}
              loading={uploading}
              loadingText={
                uploadProgress.stage === 'encrypting'
                  ? 'Encrypting...'
                  : uploadProgress.stage === 'uploading'
                  ? 'Uploading...'
                  : 'Preparing...'
              }
              className="w-full sm:flex-1"
              title={!file ? 'Select a file first' : 'Upload file and generate share link'}
            >
              Upload &amp; Share
            </Button>
          </div>

          {!file && (
            <p className="mt-4 text-xs text-center text-fg-faint">
              Your file will be securely stored and a unique link will be generated for sharing.
            </p>
          )}
        </div>
      ) : (
        <div className="border-flow rounded-3xl p-5 sm:p-6 md:p-8 text-center animate-fade-in-scale shadow-[var(--shadow-card)]">
          <span className="inline-flex w-16 h-16 sm:w-20 sm:h-20 mb-3 sm:mb-4 rounded-full bg-flow text-white items-center justify-center glow-dot animate-pop-in">
            <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10" />
          </span>
          <h3 className="text-lg sm:text-xl font-bold text-fg mb-2">
            File uploaded successfully!
          </h3>
          <p className="text-xs sm:text-sm text-fg-muted mb-4 sm:mb-6">
            Share this link with anyone to let them download your file.
            <br />
            <span className="text-fg-faint">No account required to download.</span>
          </p>

          {encryptionEnabled && encryptionSupported && (
            <div className="mb-4 flex items-center justify-center gap-2 text-sm text-brand-text">
              <Lock className="w-4 h-4" />
              <span>End-to-end encrypted — key is in the link</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 bg-surface-2 border border-edge rounded-2xl">
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="flex-1 text-xs sm:text-sm text-fg-muted bg-transparent outline-none truncate text-center sm:text-left py-2 sm:py-0"
              aria-label="Share link"
            />
            <div className="flex gap-2 justify-center sm:justify-end">
              <CopyButton text={shareUrl} />
              <button
                onClick={() => setShowQRModal(true)}
                className="px-3 py-1.5 text-sm bg-surface border border-edge text-fg-muted rounded-lg hover:bg-surface-3 hover:text-fg transition-colors cursor-pointer flex items-center gap-1.5"
                title="Show QR Code"
              >
                <QrCode className="w-4 h-4" />
                <span>QR</span>
              </button>
            </div>
          </div>

          <p className="mt-3 text-xs text-fg-faint">
            Tip: Sign in to manage your uploads and track download activity.
          </p>

          {/* Email Sharing Section */}
          {!showEmailForm ? (
            <button
              onClick={() => { setShowEmailForm(true); setEmailError(null); }}
              disabled={emailSending}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-surface border border-edge text-fg-muted rounded-xl hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer text-sm font-medium"
            >
              <Mail className="w-4 h-4" />
              Send via Email
            </button>
          ) : (
            <div className="mt-4 p-4 bg-surface border border-edge rounded-2xl animate-fade-in">
              <label htmlFor="recipientEmail" className="block text-sm font-medium text-fg mb-2 text-left">
                Recipient&apos;s email address
              </label>
              <div className="flex gap-2">
                <input
                  id="recipientEmail"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="recipient@example.com"
                  disabled={emailSending}
                  className="input-base flex-1 px-3 py-2 text-sm disabled:opacity-60"
                  onKeyDown={(e) => e.key === 'Enter' && !emailSending && handleSendEmail()}
                />
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleSendEmail}
                  disabled={!recipientEmail || emailSending}
                  loading={emailSending}
                  loadingText="Sending..."
                >
                  Send
                </Button>
              </div>
              {emailError && (
                <p className="mt-2 text-xs text-danger-text">{emailError}</p>
              )}
              <button
                onClick={() => { setShowEmailForm(false); setEmailError(null); }}
                disabled={emailSending}
                className="mt-2 text-xs text-fg-faint hover:text-fg-muted cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}

          {emailSent && (
            <p className="mt-3 text-xs text-success-text flex items-center justify-center gap-1.5 animate-fade-in">
              <CheckCircle2 className="w-3.5 h-3.5" /> Email sent successfully!
            </p>
          )}

          <button
            onClick={handleReset}
            className="mt-4 sm:mt-6 text-sm text-brand-text hover:underline cursor-pointer transition-colors duration-200 font-medium"
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
