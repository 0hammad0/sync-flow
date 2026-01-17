'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatFileSize } from '@/lib/utils';
import { getKeyFromUrl, importKey, decryptFile, isEncryptionSupported } from '@/lib/crypto';
import { incrementDownloadCount } from '@/actions/files';
import LoadingSpinner from './LoadingSpinner';

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
  downloadsRemaining,
  token,
}: DownloadCardProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);

  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');

  const getFileIcon = () => {
    if (isImage) return '🖼️';
    if (isPdf) return '📑';
    if (isVideo) return '🎬';
    if (isAudio) return '🎵';
    return '📄';
  };

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
      // Increment download count
      await incrementDownloadCount(token);

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

        // Fetch encrypted file
        const response = await fetch(signedUrl);
        if (!response.ok) {
          throw new Error('Failed to download file');
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
      } else {
        // Direct download for non-encrypted files
        const link = document.createElement('a');
        link.href = signedUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Download error:', error);
      if (error instanceof Error && error.message.includes('decrypt')) {
        setDownloadError('Failed to decrypt file. The key may be invalid.');
      } else {
        setDownloadError('Failed to download file. Please try again.');
      }
    }

    setIsDownloading(false);
  };

  return (
    <div className="w-full max-w-sm sm:max-w-md mx-auto border border-gray-200 rounded-xl p-5 sm:p-6 md:p-8 bg-white shadow-sm animate-fade-in-scale">
      <div className="text-center mb-5 sm:mb-6">
        <div className="text-5xl sm:text-6xl mb-3 sm:mb-4">{getFileIcon()}</div>
        <p className="text-xs text-gray-400 mb-1">{getFileTypeText()}</p>
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900 break-words px-2" title={fileName}>
          {fileName}
        </h2>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">{formatFileSize(fileSize)}</p>

        {/* Status badges */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {isEncrypted && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
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
              Encrypted
            </span>
          )}
          {downloadsRemaining !== null && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
              {downloadsRemaining} download{downloadsRemaining !== 1 ? 's' : ''} left
            </span>
          )}
        </div>
      </div>

      {/* File info */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Uploaded</span>
          <span className="text-gray-700">{formatCreatedDate(createdAt)}</span>
        </div>
        {expiresAt && timeRemaining && (
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Expires</span>
            <span className={`font-medium ${timeRemaining === 'Expired' ? 'text-red-600' : 'text-amber-600'}`}>
              {timeRemaining}
            </span>
          </div>
        )}
      </div>

      {downloadError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs text-red-600">{downloadError}</p>
        </div>
      )}

      <button
        onClick={handleDownload}
        disabled={isDownloading}
        className={`w-full text-center px-4 py-3 sm:py-3.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all duration-200 cursor-pointer btn-hover text-sm sm:text-base flex items-center justify-center gap-2 ${
          isDownloading ? 'opacity-75 cursor-not-allowed' : ''
        }`}
      >
        {isDownloading ? (
          <>
            <LoadingSpinner size="sm" className="text-white" />
            <span>{isEncrypted ? 'Decrypting...' : 'Downloading...'}</span>
          </>
        ) : (
          'Download File'
        )}
      </button>

      <div className="mt-4 sm:mt-5 space-y-2">
        <p className="text-[10px] sm:text-xs text-gray-400 text-center">
          {isEncrypted
            ? 'This file is end-to-end encrypted. Decryption happens in your browser.'
            : 'This download link expires in 1 hour for security.'}
        </p>
        {!isEncrypted && (
          <p className="text-[10px] sm:text-xs text-gray-400 text-center">
            After expiry, refresh the page to get a new link.
          </p>
        )}
      </div>
    </div>
  );
}
