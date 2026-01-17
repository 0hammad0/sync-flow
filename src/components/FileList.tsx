'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileRecord } from '@/types';
import { formatFileSize, getBaseUrl, MAX_USER_FILES } from '@/lib/utils';
import { deleteFile, reshareFile } from '@/actions/files';
import CopyButton from './CopyButton';
import LoadingSpinner from './LoadingSpinner';
import Link from 'next/link';

interface FileListProps {
  files: FileRecord[];
}

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 1 },
  { label: '24 hours', value: 24 },
  { label: '7 days', value: 168 },
  { label: '30 days', value: 720 },
  { label: 'Never', value: null },
];

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export default function FileList({ files }: FileListProps) {
  const router = useRouter();
  const [deletingToken, setDeletingToken] = useState<string | null>(null);
  const [resharingToken, setResharingToken] = useState<string | null>(null);
  const [showReshareModal, setShowReshareModal] = useState<string | null>(null);

  const expiredFiles = files.filter(f => isExpired(f.expires_at));
  const hasExpiredFiles = expiredFiles.length > 0;

  const handleDelete = async (token: string) => {
    if (!confirm('Are you sure you want to delete this file? This action cannot be undone and the share link will stop working.')) {
      return;
    }

    setDeletingToken(token);
    const result = await deleteFile(token);

    if (result.success) {
      router.refresh();
    } else {
      alert(result.error || 'Failed to delete file');
    }

    setDeletingToken(null);
  };

  const handleReshare = async (token: string, expiresInHours: number | null) => {
    setResharingToken(token);
    const result = await reshareFile(token, expiresInHours);

    if (result.success) {
      setShowReshareModal(null);
      router.refresh();
    } else {
      alert(result.error || 'Failed to update file');
    }

    setResharingToken(null);
  };

  if (files.length === 0) {
    return (
      <div className="text-center py-10 sm:py-12 md:py-16 border border-dashed border-gray-300 rounded-xl animate-fade-in">
        <div className="text-4xl sm:text-5xl mb-3 sm:mb-4">📂</div>
        <p className="text-gray-600 text-sm sm:text-base font-medium">No files uploaded yet</p>
        <p className="text-xs sm:text-sm text-gray-400 mt-1 mb-4">
          Files you upload while signed in will appear here.
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors duration-200 cursor-pointer btn-hover"
        >
          Upload your first file
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2 sm:space-y-3">
      {/* File count and limit indicator */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">
          {files.length} / {MAX_USER_FILES} files &bull; Click &quot;Copy&quot; to get the share link
        </p>
        {files.length >= MAX_USER_FILES && (
          <span className="text-xs text-amber-600 font-medium">Limit reached</span>
        )}
      </div>

      {/* Expired files alert */}
      {hasExpiredFiles && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 animate-fade-in">
          <div className="flex items-start gap-2">
            <span className="text-amber-500 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-medium text-amber-800">
                {expiredFiles.length} expired {expiredFiles.length === 1 ? 'file' : 'files'}
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Expired files can&apos;t be downloaded. Delete them to free up space or reshare to extend the expiry.
              </p>
            </div>
          </div>
        </div>
      )}

      {files.map((file, index) => {
        const shareUrl = `${getBaseUrl()}/share/${file.token}`;
        const isDeleting = deletingToken === file.token;
        const isResharing = resharingToken === file.token;
        const fileExpired = isExpired(file.expires_at);

        return (
          <div
            key={file.id}
            className={`border rounded-xl p-3 sm:p-4 bg-white card-hover animate-fade-in ${
              fileExpired ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200'
            }`}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900 truncate text-sm sm:text-base" title={file.original_name}>
                    {file.original_name}
                  </h3>
                  {fileExpired && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded">
                      EXPIRED
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                  {formatFileSize(file.size)} • Uploaded {new Date(file.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                  {file.expires_at && !fileExpired && (
                    <span className="text-gray-400">
                      {' '}• Expires {new Date(file.expires_at).toLocaleDateString()}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {!fileExpired && <CopyButton text={shareUrl} />}

                {/* Reshare button for expired files */}
                {fileExpired ? (
                  <button
                    onClick={() => setShowReshareModal(file.token)}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all duration-200 cursor-pointer btn-hover"
                    title="Reshare this file with a new expiry"
                  >
                    Reshare
                  </button>
                ) : (
                  <button
                    onClick={() => setShowReshareModal(file.token)}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 transition-all duration-200 cursor-pointer btn-hover"
                    title="Extend expiry time"
                  >
                    Extend
                  </button>
                )}

                <button
                  onClick={() => handleDelete(file.token)}
                  disabled={isDeleting}
                  className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5 min-w-[70px] sm:min-w-[80px] ${
                    isDeleting
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer btn-hover'
                  }`}
                  title="Permanently delete this file"
                >
                  {isDeleting ? (
                    <>
                      <LoadingSpinner size="sm" className="text-gray-400" />
                      <span className="hidden sm:inline">Deleting</span>
                    </>
                  ) : (
                    'Delete'
                  )}
                </button>
              </div>
            </div>

            {/* Reshare Modal */}
            {showReshareModal === file.token && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-600 mb-2">
                  {fileExpired ? 'Reshare with new expiry:' : 'Extend expiry to:'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXPIRY_OPTIONS.map((option) => (
                    <button
                      key={option.label}
                      onClick={() => handleReshare(file.token, option.value)}
                      disabled={isResharing}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
                        isResharing
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-blue-50 text-blue-600 hover:bg-blue-100 cursor-pointer'
                      }`}
                    >
                      {isResharing ? <LoadingSpinner size="sm" /> : option.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowReshareModal(null)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all duration-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-gray-400 text-center pt-2">
        Deleting a file will permanently remove it and disable its share link.
      </p>
    </div>
  );
}
