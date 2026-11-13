'use client';

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { formatFileSize } from '@/shared/lib/utils';
import { importKey, decryptFile, isEncryptionSupported } from '@/shared/lib/crypto';
import { requestDownload, finishDownload, requestPreview } from '@/features/files/server/files';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import ActionError from '@/shared/components/ActionError';
import { blockedError } from '@/shared/lib/blocked';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  FileType2,
  Film,
  Image as ImageIcon,
  KeyRound,
  Lock,
  Music,
} from 'lucide-react';

interface DownloadCardProps {
  fileName: string;
  fileSize: number;
  mimeType: string;
  isEncrypted: boolean;
  createdAt: string;
  expiresAt: string | null;
  downloadsRemaining: number | null;
  token: string;
}

type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text';

interface Preview {
  kind: PreviewKind;
  url?: string; // blob: URL for media / PDF
  text?: string; // plain-text previews
}

// Files at or under this size load their preview on their own.
const AUTO_PREVIEW_BYTES = 10 * 1024 * 1024;
// Text previews are rendered inline, so keep them small.
const TEXT_PREVIEW_BYTES = 1024 * 1024;
const TEXT_PREVIEW_CHARS = 50_000;
// AES-256 key, URL-safe base64 without padding.
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

const KEY_MISSING_MSG =
  "This link is missing its key, so the file can't be decrypted. Ask the sender for the full link (it ends with # and a long code).";
const KEY_WRONG_MSG = "This link's key is wrong or incomplete. Ask the sender for the full link.";

// requestDownload's signed URL lives 5 minutes; retry within 4 so the
// transfer starts well before it runs out.
const RETRY_WINDOW_MS = 4 * 60 * 1000;

/** A counted download whose transfer failed, kept so Retry doesn't count again. */
interface PendingGrant {
  signedUrl: string;
  lastDownload: boolean;
  retryUntil: number;
}

/** Thrown when the key can't be imported or doesn't decrypt the file. */
class KeyError extends Error {}

function previewKindFor(mimeType: string, size: number): PreviewKind | null {
  // An SVG is a document that can carry script. Previewed through a blob: URL
  // on our origin, "Open image in new tab" would run that script as us.
  if (mimeType === 'image/svg+xml') return null;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if ((mimeType.startsWith('text/') || mimeType === 'application/json') && size <= TEXT_PREVIEW_BYTES) {
    return 'text';
  }
  return null;
}

// The #key lives only in the browser, so read it as an external store:
// null on the server, the current hash on the client.
function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function saveBlob(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function formatTimeRemaining(expiryDate: Date): string {
  const diffMs = expiryDate.getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';

  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 0) return `${diffDays}d ${diffHours % 24}h remaining`;
  if (diffHours > 0) return `${diffHours}h ${diffMins % 60}m remaining`;
  return `${diffMins}m remaining`;
}

export default function DownloadCard({
  fileName,
  fileSize,
  mimeType,
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
  const [serverExpired, setServerExpired] = useState(false);
  const [fileDeleted, setFileDeleted] = useState(false);
  // The downloaded (and decrypted) file, kept so "Download again" doesn't
  // spend another download.
  const [savedBlob, setSavedBlob] = useState<Blob | null>(null);
  const [retryGrant, setRetryGrant] = useState<PendingGrant | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const hasLimit = initialDownloadsRemaining !== null;
  const previewKind = previewKindFor(mimeType, fileSize);

  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  const keyBase64 = hash && hash.length > 1 ? hash.slice(1) : '';
  // null while rendering on the server (hash unknown yet).
  const keyProblem: string | null =
    !isEncrypted || hash === null
      ? null
      : !keyBase64
      ? KEY_MISSING_MSG
      : !KEY_RE.test(keyBase64)
      ? KEY_WRONG_MSG
      : null;

  const isExpired = serverExpired || timeRemaining === 'Expired';
  const limitReached = currentDownloadsRemaining !== null && currentDownloadsRemaining <= 0;

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

  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      setTimeRemaining(formatTimeRemaining(new Date(expiresAt)));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 30000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  // Revoke the preview's blob URL when it is replaced or the card unmounts.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

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

  /** Fetch a signed URL and return the plain file (decrypted if needed). */
  const fetchFile = useCallback(
    async (signedUrl: string): Promise<Blob> => {
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
      }
      if (!isEncrypted) {
        const raw = await response.blob();
        return raw.slice(0, raw.size, mimeType);
      }

      const encryptedData = await response.arrayBuffer();
      let key: CryptoKey;
      try {
        key = await importKey(keyBase64);
      } catch {
        throw new KeyError('import');
      }
      let decrypted: ArrayBuffer;
      try {
        decrypted = await decryptFile(encryptedData, key);
      } catch {
        throw new KeyError('decrypt');
      }
      return new Blob([decrypted], { type: mimeType });
    },
    [isEncrypted, keyBase64, mimeType]
  );

  const showPreview = useCallback(
    async (blob: Blob) => {
      if (!previewKind) return;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      if (previewKind === 'text') {
        const text = await blob.text();
        setPreview({ kind: 'text', text: text.slice(0, TEXT_PREVIEW_CHARS) });
        return;
      }
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreview({ kind: previewKind, url });
    },
    [previewKind]
  );

  // Preview without downloading. Only for files without a download limit —
  // the server refuses otherwise, so a preview can never skip the count.
  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const grant = await requestPreview(token);
      if (!grant.success || !grant.signedUrl) {
        setPreviewError(
          blockedError(grant) ?? (grant.error === 'expired' ? 'This link has expired.' : "Couldn't load the preview.")
        );
        return;
      }
      await showPreview(await fetchFile(grant.signedUrl));
    } catch (error) {
      setPreviewError(blockedError(error) ?? (error instanceof KeyError ? KEY_WRONG_MSG : "Couldn't load the preview."));
    } finally {
      setPreviewLoading(false);
    }
  }, [token, fetchFile, showPreview]);

  // Small files without a limit preview on their own.
  const canPreviewFirst =
    !!previewKind && !hasLimit && !keyProblem && hash !== null && (!isEncrypted || isEncryptionSupported());
  const autoPreview = canPreviewFirst && fileSize <= AUTO_PREVIEW_BYTES && !isExpired;
  const autoPreviewStarted = useRef(false);
  useEffect(() => {
    if (!autoPreview || autoPreviewStarted.current) return;
    autoPreviewStarted.current = true;
    void loadPreview();
  }, [autoPreview, loadPreview]);

  const handleDownload = async () => {
    // Already have the file: save it again without spending a download.
    if (savedBlob) {
      saveBlob(savedBlob, fileName);
      return;
    }
    if (keyProblem) {
      setDownloadError(keyProblem);
      return;
    }
    if (isEncrypted && !isEncryptionSupported()) {
      setDownloadError('Your browser does not support decryption.');
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);

    let signedUrl: string;
    let lastDownload: boolean;
    if (retryGrant && retryGrant.retryUntil > Date.now()) {
      // Same counted download as the failed attempt.
      ({ signedUrl, lastDownload } = retryGrant);
    } else {
      if (retryGrant) {
        setRetryGrant(null);
        if (retryGrant.lastDownload) {
          // Nothing left to claim: the failed attempt used the last download.
          setDownloadError(
            'Too much time has passed to retry, and that was the last allowed download. Ask the sender to share the file again.'
          );
          setIsDownloading(false);
          return;
        }
      }
      // The server counts the download first, then hands out a 5-minute URL.
      let grant: Awaited<ReturnType<typeof requestDownload>>;
      try {
        grant = await requestDownload(token);
      } catch (error) {
        // A blocked visitor's action is stopped by the proxy (403); the Next client throws.
        setDownloadError(blockedError(error) ?? 'Something went wrong. Please try again.');
        setIsDownloading(false);
        return;
      }
      if (!grant.success || !grant.signedUrl) {
        const blocked = blockedError(grant);
        if (blocked) {
          setDownloadError(blocked);
        } else if (grant.error === 'expired') {
          setServerExpired(true);
          setDownloadError('This link has expired.');
        } else if (grant.error === 'download_limit_reached') {
          setCurrentDownloadsRemaining(0);
          setDownloadError('This file has reached its download limit.');
        } else if (grant.error === 'not_found') {
          setDownloadError('File not found. It may have been deleted. Refresh the page to check.');
        } else {
          setDownloadError('Something went wrong. Please try again.');
        }
        setIsDownloading(false);
        return;
      }
      if (grant.downloadsRemaining !== undefined) {
        setCurrentDownloadsRemaining(grant.downloadsRemaining);
      }
      signedUrl = grant.signedUrl;
      lastDownload = !!grant.lastDownload;
    }

    let blob: Blob;
    try {
      blob = await fetchFile(signedUrl);
    } catch (error) {
      console.error('Download error:', error);
      if (error instanceof KeyError) {
        // Retrying can't fix a wrong key.
        setRetryGrant(null);
        setDownloadError(KEY_WRONG_MSG);
      } else {
        // The download is already counted: keep its URL so Retry reuses it.
        // A last-download file is not deleted (the sweep removes it later).
        setRetryGrant({ signedUrl, lastDownload, retryUntil: Date.now() + RETRY_WINDOW_MS });
        setDownloadError(
          error instanceof Error && /\b(403|404)\b/.test(error.message)
            ? 'File not found in storage. It may have been deleted. Please refresh the page.'
            : 'Download failed. Check your connection and try again.'
        );
      }
      setIsDownloading(false);
      return;
    }

    saveBlob(blob, fileName);
    setSavedBlob(blob);
    setRetryGrant(null);
    if (previewKind && !preview) void showPreview(blob);
    // Last allowed download, and the user has the file: delete it now
    // (self-destruct). Only after a successful save, never on failure.
    if (lastDownload) {
      await finishDownload(token).catch(() => {});
      setFileDeleted(true);
    }
    setIsDownloading(false);
  };

  // A pending retry stays usable even though the count already shows 0 left.
  const downloadDisabled =
    isDownloading ||
    (!savedBlob && !retryGrant && (isExpired || limitReached || fileDeleted || !!keyProblem));

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
            <span className={`font-medium ${isExpired ? 'text-danger-text' : 'text-warning-text'}`}>
              {isExpired ? 'Expired' : timeRemaining}
            </span>
          </div>
        )}
      </div>

      {/* Preview */}
      {preview && (
        <div className="mb-4 overflow-hidden rounded-2xl border border-edge bg-surface-2">
          {preview.kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL, not optimizable
            <img src={preview.url} alt={`Preview of ${fileName}`} className="w-full max-h-80 object-contain bg-surface-3" />
          )}
          {preview.kind === 'video' && (
            <video src={preview.url} controls className="w-full max-h-80 bg-black" aria-label={`Preview of ${fileName}`} />
          )}
          {preview.kind === 'audio' && (
            <audio src={preview.url} controls className="w-full p-2" aria-label={`Preview of ${fileName}`} />
          )}
          {preview.kind === 'pdf' && (
            <iframe src={preview.url} title={`Preview of ${fileName}`} className="w-full h-80 bg-white" />
          )}
          {preview.kind === 'text' && (
            <pre className="max-h-80 overflow-auto p-3 text-xs text-fg-muted whitespace-pre-wrap break-words">
              {preview.text}
            </pre>
          )}
        </div>
      )}
      {!preview && canPreviewFirst && !isExpired && (
        <button
          type="button"
          onClick={() => void loadPreview()}
          disabled={previewLoading}
          className="mb-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-surface border border-edge text-fg-muted rounded-xl hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {previewLoading ? <LoadingSpinner size="sm" /> : <Eye className="w-4 h-4" />}
          {previewLoading ? 'Loading preview...' : 'Preview'}
        </button>
      )}
      {!preview && previewKind && hasLimit && !savedBlob && !limitReached && !isExpired && (
        <p className="mb-4 text-xs text-fg-faint text-center">
          This link has a download limit, so the preview shows after you download.
        </p>
      )}
      {previewError && !preview && (
        <p className="mb-4 text-xs text-fg-faint text-center" role="status"><ActionError text={previewError} /></p>
      )}

      {/* Key problems replace the button: there is nothing to download with. */}
      {keyProblem && !savedBlob ? (
        <div className="mb-4 p-3 bg-warning/10 border border-warning/20 rounded-2xl" role="alert">
          <p className="text-xs text-fg font-medium inline-flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-warning-text" />
            Can&apos;t open this file
          </p>
          <p className="text-xs text-fg-muted mt-1">{keyProblem}</p>
        </div>
      ) : (
        <>
          <div aria-live="polite">
            {downloadError && (
              <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-2xl" role="alert">
                <p className="text-xs text-danger-text inline-flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span><ActionError text={downloadError} /></span>
                </p>
                {retryGrant && (
                  <p className="text-xs text-fg-muted mt-1">
                    Retry within a few minutes and it won&apos;t use up another download.
                  </p>
                )}
              </div>
            )}

            {savedBlob && (
              <div className="mb-4 p-3 bg-success/10 border border-success/20 rounded-2xl" role="status">
                <p className="text-xs text-success-text font-medium inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Download complete
                </p>
                {fileDeleted && (
                  <p className="text-xs text-fg-muted mt-1">
                    That was the last allowed download, so the file has been deleted from SyncFlow.
                  </p>
                )}
              </div>
            )}
            {!savedBlob && fileDeleted && (
              <div className="mb-4 p-3 bg-surface-2 border border-edge rounded-2xl" role="status">
                <p className="text-xs text-fg-muted">
                  The last allowed download was used, so the file has been deleted.
                </p>
              </div>
            )}
          </div>

          <button
            onClick={handleDownload}
            disabled={downloadDisabled}
            className={`w-full text-center px-4 py-3 sm:py-3.5 bg-flow text-white font-medium rounded-xl transition-all duration-200 cursor-pointer btn-hover hover:shadow-[var(--glow)] hover:brightness-110 text-sm sm:text-base flex items-center justify-center gap-2 ${
              downloadDisabled ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            {isDownloading ? (
              <>
                <LoadingSpinner size="sm" className="text-white" />
                <span>{isEncrypted ? 'Downloading and decrypting...' : 'Downloading...'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 sm:w-5 sm:h-5" />
                {savedBlob
                  ? 'Download again'
                  : retryGrant
                  ? 'Retry download'
                  : isExpired
                  ? 'Link expired'
                  : limitReached
                  ? 'No downloads left'
                  : 'Download File'}
              </>
            )}
          </button>
        </>
      )}

      {isEncrypted && (
        <p className="mt-4 sm:mt-5 text-[10px] sm:text-xs text-fg-faint text-center">
          This file is end-to-end encrypted. Decryption happens in your browser.
        </p>
      )}
    </div>
  );
}
