'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatFileSize } from '@/lib/utils';
import { getKeyFromUrl, importKey, decryptFile, isEncryptionSupported } from '@/lib/crypto';
import { incrementDownloadCount } from '@/actions/files';
import LoadingSpinner from './LoadingSpinner';
import {
  CheckCircle2,
  Download,
  FileText,
  FileType2,
  Film,
  Image as ImageIcon,
  Lock,
  Music,
} from 'lucide-react';

interface DownloadCardProps {
  fileName: string;
  fileSize: number;
  mimeType: string;
  signedUrl: string;
  isEncrypted: boolean;
  createdAt: string;
  expiresAt: string | null;
  downloadsRemaining: number | null;
  token: string;
}

export default function DownloadCard({
  fileName,
  fileSize,
  mimeType,
  signedUrl,
  isEncrypted,
  createdAt,
  expiresAt,
  downloadsRemaining: initialDownloadsRemaining,
  token,
}: DownloadCardProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);
  const [currentDownloadsRemaining, setCurrentDownloadsRemaining] = useState(initialDownloadsRemaining);
  const [fileDeleted, setFileDeleted] = useState(false);

  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');

  const FileIcon = isImage
    ? ImageIcon
    : isPdf
    ? FileType2
    : isVideo
    ? Film
    : isAudio
    ? Music
    : FileText;

  const getFileTypeText = () => {
    if (isImage) return 'Image file';
    if (isPdf) return 'PDF document';
    if (isVideo) return 'Video file';
    if (isAudio) return 'Audio file';
    return 'File';
  };

  const formatTimeRemaining = useCallback((expiryDate: Date): string => {
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();

    if (diffMs <= 0) return 'Expired';

    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      return `${diffDays}d ${diffHours % 24}h remaining`;
    }
    if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m remaining`;
    }
    return `${diffMins}m remaining`;
  }, []);

  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      const expiryDate = new Date(expiresAt);
      setTimeRemaining(formatTimeRemaining(expiryDate));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [expiresAt, formatTimeRemaining]);

  const formatCreatedDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadError(null);

    try {
      if (isEncrypted) {
        // Get encryption key from URL fragment
        const keyBase64 = getKeyFromUrl();

        if (!keyBase64) {
          setDownloadError('Decryption key not found in URL. The link may be incomplete.');
          setIsDownloading(false);
          return;
        }

        if (!isEncryptionSupported()) {
          setDownloadError('Your browser does not support decryption.');
          setIsDownloading(false);
          return;
        }

        // Fetch encrypted file FIRST (before incrementing count)
        const response = await fetch(signedUrl);
        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
        }

        const encryptedData = await response.arrayBuffer();

        // Import key and decrypt
        const key = await importKey(keyBase64);
        const decryptedData = await decryptFile(encryptedData, key);

        // Create blob URL and trigger download
        const blob = new Blob([decryptedData], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up blob URL
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

        // Increment download count AFTER successful download
        // This ensures the file isn't deleted before download completes
        const result = await incrementDownloadCount(token);

        // Update UI with new count
        if (currentDownloadsRemaining !== null) {
          const newCount = currentDownloadsRemaining - 1;
          setCurrentDownloadsRemaining(newCount);
          if (result.selfDestruct || newCount <= 0) {
            setFileDeleted(true);
          }
        }
      } else {
        // For non-encrypted files, fetch the file first to ensure we have it
        const response = await fetch(signedUrl);
        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up blob URL
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

        // Increment download count AFTER successful download
        const result = await incrementDownloadCount(token);

        // Update UI with new count
        if (currentDownloadsRemaining !== null) {
          const newCount = currentDownloadsRemaining - 1;
          setCurrentDownloadsRemaining(newCount);
          if (result.selfDestruct || newCount <= 0) {
            setFileDeleted(true);
          }
        }
      }
    } catch (error) {
      console.error('Download error:', error);
      if (error instanceof Error) {
        if (error.message.includes('decrypt')) {
          setDownloadError('Failed to decrypt file. The key may be invalid.');
        } else if (error.message.includes('404') || error.message.includes('400') || error.message.includes('not found')) {
          setDownloadError('File not found in storage. It may have been deleted. Please refresh the page.');
        } else {
          setDownloadError('Failed to download file. Please refresh the page and try again.');
        }
      } else {
        setDownloadError('Failed to download file. Please refresh the page and try again.');
      }
    }

    setIsDownloading(false);
  };

  return (
    <div className="w-full max-w-sm sm:max-w-md mx-auto border-flow rounded-3xl p-5 sm:p-6 md:p-8 shadow-[var(--shadow-card)] animate-fade-in-scale">
      <div className="text-center mb-5 sm:mb-6">
        <span className="inline-flex w-16 h-16 sm:w-20 sm:h-20 mb-3 sm:mb-4 rounded-3xl bg-flow text-white items-center justify-center glow-dot animate-pop-in">
          <FileIcon className="w-8 h-8 sm:w-10 sm:h-10" />
        </span>
        <p className="text-xs text-fg-faint mb-1">{getFileTypeText()}</p>
        <h2 className="text-lg sm:text-xl font-bold text-fg break-words px-2" title={fileName}>
          {fileName}
        </h2>
        <p className="text-xs sm:text-sm text-fg-muted mt-1">{formatFileSize(fileSize)}</p>

        {/* Status badges */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {isEncrypted && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand/10 text-brand-text text-xs rounded-full font-medium">
              <Lock className="w-3 h-3" />
              Encrypted
            </span>
          )}
          {currentDownloadsRemaining !== null && (
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full font-medium ${
              currentDownloadsRemaining <= 0 ? 'bg-danger/10 text-danger-text' : 'bg-brand-2/10 text-fg-muted'
            }`}>
              {currentDownloadsRemaining <= 0 ? 'No downloads left' : `${currentDownloadsRemaining} download${currentDownloadsRemaining !== 1 ? 's' : ''} left`}
            </span>
          )}
        </div>
      </div>

      {/* File info */}
      <div className="mb-4 p-3 bg-surface-2 border border-edge rounded-2xl space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-fg-faint">Uploaded</span>
          <span className="text-fg-muted">{formatCreatedDate(createdAt)}</span>
        </div>
        {expiresAt && timeRemaining && (
          <div className="flex justify-between text-xs">
            <span className="text-fg-faint">Expires</span>
            <span className={`font-medium ${timeRemaining === 'Expired' ? 'text-danger-text' : 'text-warning-text'}`}>
              {timeRemaining}
            </span>
          </div>
        )}
      </div>

      {downloadError && (
        <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-2xl">
          <p className="text-xs text-danger-text">{downloadError}</p>
        </div>
      )}

      {fileDeleted ? (
        <div className="mb-4 p-3 bg-success/10 border border-success/20 rounded-2xl">
          <p className="text-xs text-success-text font-medium inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Download complete!
          </p>
          <p className="text-xs text-fg-muted mt-1">
            This file has reached its download limit and has been automatically deleted for security.
          </p>
        </div>
      ) : (
        <button
          onClick={handleDownload}
          disabled={isDownloading || currentDownloadsRemaining === 0}
          className={`w-full text-center px-4 py-3 sm:py-3.5 bg-flow text-white font-medium rounded-xl transition-all duration-200 cursor-pointer btn-hover hover:shadow-[var(--glow)] hover:brightness-110 text-sm sm:text-base flex items-center justify-center gap-2 ${
            isDownloading || currentDownloadsRemaining === 0 ? 'opacity-60 cursor-not-allowed' : ''
          }`}
        >
          {isDownloading ? (
            <>
              <LoadingSpinner size="sm" className="text-white" />
              <span>{isEncrypted ? 'Decrypting...' : 'Downloading...'}</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4 sm:w-5 sm:h-5" />
              Download File
            </>
          )}
        </button>
      )}

      <div className="mt-4 sm:mt-5 space-y-2">
        <p className="text-[10px] sm:text-xs text-fg-faint text-center">
          {isEncrypted
            ? 'This file is end-to-end encrypted. Decryption happens in your browser.'
            : 'This download link expires in 1 hour for security.'}
        </p>
        {!isEncrypted && (
          <p className="text-[10px] sm:text-xs text-fg-faint text-center">
            After expiry, refresh the page to get a new link.
          </p>
        )}
      </div>
    </div>
  );
}
