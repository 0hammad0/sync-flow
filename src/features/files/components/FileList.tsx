'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileRecord } from '@/types';
import { formatFileSize, getBaseUrl, MAX_USER_FILES } from '@/shared/lib/utils';
import { SHARE_EXPIRY_OPTIONS } from '@/shared/lib/limits';
import { deleteFile, reshareFile } from '@/features/files/server/files';
import CopyButton from '@/shared/components/CopyButton';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import Button from '@/shared/ui/Button';
import QRModal from '@/features/files/components/QRModal';
import { AlertTriangle, FolderOpen, Lock, QrCode } from 'lucide-react';

interface FileListProps {
  files: FileRecord[];
}

// Every choice a signed-in user has (reshareFile accepts the same set).
// Short "Never" label: these sit in a row of small buttons.
const EXPIRY_OPTIONS = SHARE_EXPIRY_OPTIONS.map((o) => ({
  label: o.hours === null ? 'Never' : o.label,
  value: o.hours,
}));

const ENCRYPTED_LINK_HELP =
  "The decryption key is only in the link shown right after upload. SyncFlow never stores it, so the full link can't be shown again. Use the link you copied then.";

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

/** "in 43m" / "in 5h" / "in 6 days" / "Never". */
function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'Never';
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const mins = Math.max(1, Math.floor(diffMs / 60_000));
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

function formatDownloads(file: FileRecord): string {
  const count = file.download_count ?? 0;
  if (file.max_downloads !== null) return `${count} / ${file.max_downloads} downloads`;
  return `${count} download${count === 1 ? '' : 's'}`;
}

export default function FileList({ files }: FileListProps) {
  const router = useRouter();
  const [deletingToken, setDeletingToken] = useState<string | null>(null);
  const [confirmDeleteToken, setConfirmDeleteToken] = useState<string | null>(null);
  const [resharingToken, setResharingToken] = useState<string | null>(null);
  const [showReshareModal, setShowReshareModal] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ token: string; message: string } | null>(null);
  const [qrFile, setQrFile] = useState<FileRecord | null>(null);

  const expiredFiles = files.filter(f => isExpired(f.expires_at));
  const hasExpiredFiles = expiredFiles.length > 0;

  const handleDelete = async (token: string) => {
    setDeletingToken(token);
    setRowError(null);
    const result = await deleteFile(token);

    if (result.success) {
      setConfirmDeleteToken(null);
      router.refresh();
    } else {
      setRowError({ token, message: result.error || 'Failed to delete file' });
    }

    setDeletingToken(null);
  };

  const handleReshare = async (token: string, expiresInHours: number | null) => {
    setResharingToken(token);
    setRowError(null);
    const result = await reshareFile(token, expiresInHours);

    if (result.success) {
      setShowReshareModal(null);
      router.refresh();
    } else {
      setRowError({ token, message: result.error || 'Failed to update file' });
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
                Expired files can&apos;t be downloaded. Delete them to free up space, or reshare to set a new expiry.
              </p>
            </div>
          </div>
        </div>
      )}

      {files.map((file, index) => {
        const shareUrl = `${getBaseUrl()}/share/${file.token}`;
        const isDeleting = deletingToken === file.token;
        const isResharing = resharingToken === file.token;
        const isConfirmingDelete = confirmDeleteToken === file.token;
        const fileExpired = isExpired(file.expires_at);
        const limitReached =
          file.max_downloads !== null && (file.download_count ?? 0) >= file.max_downloads;
        const error = rowError?.token === file.token ? rowError.message : null;

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
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="font-medium text-fg truncate text-sm sm:text-base" title={file.original_name}>
                    {file.original_name}
                  </h3>
                  {file.is_encrypted && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-brand/10 text-brand-text rounded-md"
                      title={ENCRYPTED_LINK_HELP}
                    >
                      <Lock className="w-3 h-3" aria-hidden="true" />
                      ENCRYPTED
                    </span>
                  )}
                  {fileExpired && (
                    <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-semibold bg-warning/15 text-warning-text rounded-md">
                      EXPIRED
                    </span>
                  )}
                  {limitReached && (
                    <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-semibold bg-danger/10 text-danger-text rounded-md">
                      LIMIT REACHED
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-fg-muted mt-0.5">
                  {formatFileSize(file.size)} • Uploaded {new Date(file.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </p>
                <p className="text-xs text-fg-faint mt-0.5">
                  {formatDownloads(file)}
                  {!fileExpired && (
                    <span
                      suppressHydrationWarning
                      title={file.expires_at ? new Date(file.expires_at).toLocaleString() : undefined}
                    >
                      {' '}• Expires {formatExpiry(file.expires_at)}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                {!fileExpired &&
                  (file.is_encrypted ? (
                    <span
                      className="text-[11px] text-fg-faint max-w-[11rem] leading-tight"
                      title={ENCRYPTED_LINK_HELP}
                    >
                      Encrypted — link only shown at upload
                    </span>
                  ) : (
                    <>
                      <CopyButton text={shareUrl} />
                      <button
                        type="button"
                        onClick={() => setQrFile(file)}
                        className="px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg bg-surface-2 border border-edge text-fg-muted hover:bg-surface-3 hover:text-fg transition-all duration-200 cursor-pointer btn-hover inline-flex items-center gap-1.5"
                        title="Show QR code"
                        aria-label={`Show QR code for ${file.original_name}`}
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">QR</span>
                      </button>
                    </>
                  ))}

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
                    title="Set a new expiry, counted from now"
                  >
                    Set expiry
                  </button>
                )}

                {!isConfirmingDelete && (
                  <button
                    onClick={() => {
                      setConfirmDeleteToken(file.token);
                      setRowError(null);
                    }}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 bg-danger/10 text-danger-text hover:bg-danger/20 cursor-pointer btn-hover"
                    title="Permanently delete this file"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {/* Inline delete confirmation */}
            {isConfirmingDelete && (
              <div className="mt-3 pt-3 border-t border-edge flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <p className="text-xs text-fg-muted" role="alert">
                  Delete this file? The link stops working and it can&apos;t be undone.
                </p>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleDelete(file.token)}
                    disabled={isDeleting}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 inline-flex items-center gap-1.5 ${
                      isDeleting
                        ? 'bg-surface-2 text-fg-faint cursor-not-allowed'
                        : 'bg-danger text-white hover:brightness-110 cursor-pointer'
                    }`}
                  >
                    {isDeleting ? (
                      <>
                        <LoadingSpinner size="sm" className="text-fg-faint" />
                        Deleting
                      </>
                    ) : (
                      'Yes, delete'
                    )}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteToken(null)}
                    disabled={isDeleting}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-2 text-fg-muted hover:bg-surface-3 transition-all duration-200 cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Set expiry panel */}
            {showReshareModal === file.token && (
              <div className="mt-3 pt-3 border-t border-edge">
                <p className="text-xs text-fg-muted mb-2">
                  {fileExpired ? 'Reshare with a new expiry, counted from now:' : 'New expiry, counted from now (this replaces the current one):'}
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

            <div aria-live="polite">
              {error && (
                <p className="mt-2 text-xs text-danger-text" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-fg-faint text-center pt-2">
        Deleting a file will permanently remove it and disable its share link.
      </p>

      <QRModal
        isOpen={qrFile !== null}
        onClose={() => setQrFile(null)}
        url={qrFile ? `${getBaseUrl()}/share/${qrFile.token}` : ''}
        fileName={qrFile?.original_name || ''}
      />
    </div>
  );
}
