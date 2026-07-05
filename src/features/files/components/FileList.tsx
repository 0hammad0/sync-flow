'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileRecord } from '@/types';
import { formatFileSize, getBaseUrl, MAX_USER_FILES } from '@/shared/lib/utils';
import { deleteFile, reshareFile } from '@/features/files/server/files';
import CopyButton from '@/shared/components/CopyButton';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import Button from '@/shared/components/ui/Button';
import { AlertTriangle, FolderOpen } from 'lucide-react';

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
      <div className="text-center py-10 sm:py-12 md:py-16 border border-dashed border-edge-strong rounded-3xl animate-fade-in">
        <span className="inline-flex w-14 h-14 sm:w-16 sm:h-16 mb-3 sm:mb-4 rounded-2xl bg-brand/10 text-brand-text items-center justify-center">
          <FolderOpen className="w-7 h-7 sm:w-8 sm:h-8" />
        </span>
        <p className="text-fg text-sm sm:text-base font-semibold">No files uploaded yet</p>
        <p className="text-xs sm:text-sm text-fg-faint mt-1 mb-4">
          Files you upload while signed in will appear here.
        </p>
        <Button href="/" variant="primary" size="md">
          Upload your first file
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 sm:space-y-3">
      {/* File count and limit indicator */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-fg-muted">
          {files.length} / {MAX_USER_FILES} files &bull; Click &quot;Copy&quot; to get the share link
        </p>
        {files.length >= MAX_USER_FILES && (
          <span className="text-xs text-warning-text font-medium">Limit reached</span>
        )}
      </div>

      {/* Expired files alert */}
      {hasExpiredFiles && (
        <div className="bg-warning/10 border border-warning/20 rounded-2xl p-3 mb-4 animate-fade-in">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-warning-text mt-0.5" />
            <div>
              <p className="text-sm font-medium text-fg">
                {expiredFiles.length} expired {expiredFiles.length === 1 ? 'file' : 'files'}
              </p>
              <p className="text-xs text-fg-muted mt-0.5">
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
            className={`border rounded-2xl p-3 sm:p-4 bg-surface card-hover animate-fade-in ${
              fileExpired ? 'border-warning/30' : 'border-edge'
            }`}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-fg truncate text-sm sm:text-base" title={file.original_name}>
                    {file.original_name}
                  </h3>
                  {fileExpired && (
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-warning/15 text-warning-text rounded-md">
                      EXPIRED
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-fg-muted mt-0.5">
                  {formatFileSize(file.size)} • Uploaded {new Date(file.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                  {file.expires_at && !fileExpired && (
                    <span className="text-fg-faint">
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
                    className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg bg-brand/10 text-brand-text hover:bg-brand/20 transition-all duration-200 cursor-pointer btn-hover"
                    title="Reshare this file with a new expiry"
                  >
                    Reshare
                  </button>
                ) : (
                  <button
                    onClick={() => setShowReshareModal(file.token)}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg bg-surface-2 text-fg-muted hover:bg-surface-3 hover:text-fg transition-all duration-200 cursor-pointer btn-hover"
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
                      ? 'bg-surface-2 text-fg-faint cursor-not-allowed'
                      : 'bg-danger/10 text-danger-text hover:bg-danger/20 cursor-pointer btn-hover'
                  }`}
                  title="Permanently delete this file"
                >
                  {isDeleting ? (
                    <>
                      <LoadingSpinner size="sm" className="text-fg-faint" />
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
              <div className="mt-3 pt-3 border-t border-edge">
                <p className="text-xs text-fg-muted mb-2">
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
                          ? 'bg-surface-2 text-fg-faint cursor-not-allowed'
                          : 'bg-brand/10 text-brand-text hover:bg-brand/20 cursor-pointer'
                      }`}
                    >
                      {isResharing ? <LoadingSpinner size="sm" /> : option.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowReshareModal(null)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-2 text-fg-muted hover:bg-surface-3 transition-all duration-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-fg-faint text-center pt-2">
        Deleting a file will permanently remove it and disable its share link.
      </p>
    </div>
  );
}
