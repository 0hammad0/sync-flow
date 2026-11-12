'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatFileSize } from '@/shared/lib/utils';
import { useCopy } from '@/shared/lib/clipboard';
import { UploadProgress } from '@/types';
import {
  generateKey,
  exportKey,
  encryptFile,
  isEncryptionSupported,
} from '@/shared/lib/crypto';
import { directUpload, CANCELLED_MESSAGE } from '@/shared/lib/direct-upload';
import {
  DEFAULT_GUEST_EXPIRY_HOURS,
  ENCRYPTION_OVERHEAD_BYTES,
  MAX_DOWNLOADS,
  MAX_UPLOAD_BYTES,
  SHARE_EXPIRY_OPTIONS,
} from '@/shared/lib/limits';
import CopyButton from '@/shared/components/CopyButton';
import ProgressBar from '@/features/files/components/ProgressBar';
import QRModal from '@/features/files/components/QRModal';
import Button from '@/shared/components/ui/Button';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Image as ImageIcon,
  Lock,
  Mail,
  QrCode,
  RotateCcw,
  Share2,
  UploadCloud,
  X,
} from 'lucide-react';

const ALLOWED_TYPES_TEXT = 'All file types supported';
const MAX_SIZE_TEXT = 'Maximum file size: 100MB';

// <select> values: hours as a string, '' = never expires. The server
// accepts exactly these (isAllowedExpiry in limits.ts).
const toOption = (o: (typeof SHARE_EXPIRY_OPTIONS)[number]) => ({
  value: o.hours === null ? '' : String(o.hours),
  label: o.label,
});
const GUEST_EXPIRY_OPTIONS = SHARE_EXPIRY_OPTIONS.filter((o) => o.guest).map(toOption);
// Signed-in users see "Never expires" first: it is their default.
const USER_EXPIRY_OPTIONS = [
  ...SHARE_EXPIRY_OPTIONS.filter((o) => o.hours === null),
  ...SHARE_EXPIRY_OPTIONS.filter((o) => o.hours !== null),
].map(toOption);
const GUEST_DEFAULT_EXPIRY = String(DEFAULT_GUEST_EXPIRY_HOURS);

/** The server checks the bytes it receives: ciphertext is 28 bytes longer. */
function fitsUploadLimit(size: number, encrypt: boolean): boolean {
  return size + (encrypt ? ENCRYPTION_OVERHEAD_BYTES : 0) <= MAX_UPLOAD_BYTES;
}

interface UploadFormProps {
  isAuthenticated?: boolean;
}

// One entry per uploaded file: a share link on success, an error otherwise.
// Failed entries keep their File so "Retry failed" can send them again.
interface UploadedLink {
  name: string;
  url?: string;
  error?: string;
  file?: File;
  encrypted?: boolean;
  /** The server says the sign-in has expired. */
  signInRequired?: boolean;
}

function maxDownloadsProblem(value: string): string | null {
  if (value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DOWNLOADS) {
    return `Use a whole number from 1 to ${MAX_DOWNLOADS}, or leave it empty for unlimited.`;
  }
  return null;
}

/** Opens in a new tab so the selected files and options stay on this page. */
function SignInAgainLink() {
  return (
    <p className="text-xs text-danger-text/80 mt-1">
      <a
        href="/login?next=/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline hover:no-underline"
      >
        Sign in again
      </a>{' '}
      (opens in a new tab), then come back and press Upload or Retry.
    </p>
  );
}

export default function UploadForm({ isAuthenticated = false }: UploadFormProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadedLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The last upload failed because the server session has expired.
  const [signInNeeded, setSignInNeeded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageDrag, setPageDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Cancels the upload in progress.
  const abortRef = useRef<AbortController | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  // Links that already worked, kept while "Retry failed" re-sends the rest.
  const keptRef = useRef<UploadedLink[]>([]);

  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    stage: 'idle',
    percent: 0,
  });
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  const encryptionSupported = useMemo(() => isEncryptionSupported(), []);
  const encryptionOn = encryptionEnabled && encryptionSupported;
  // null = not chosen yet. Derived instead of seeded on mount so a change in
  // sign-in state just updates the list — no remount, so an upload in
  // progress is never thrown away. A choice the current list lacks (e.g.
  // "Never" after signing out) falls back to the default, visibly.
  const [expiryChoice, setExpiryChoice] = useState<string | null>(null);
  const expiryOptions = isAuthenticated ? USER_EXPIRY_OPTIONS : GUEST_EXPIRY_OPTIONS;
  const expiryHours =
    expiryChoice !== null && expiryOptions.some((o) => o.value === expiryChoice)
      ? expiryChoice
      : isAuthenticated
      ? '' // never expires
      : GUEST_DEFAULT_EXPIRY;
  const [maxDownloads, setMaxDownloads] = useState<string>('');
  const [qrTarget, setQrTarget] = useState<UploadedLink | null>(null);
  const [autoCopied, setAutoCopied] = useState(false);
  const { copied: allCopied, copy: copyAll } = useCopy();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const maxDownloadsError = maxDownloadsProblem(maxDownloads);
  const successful = results?.filter((r) => r.url) ?? [];
  const retryable = results?.filter((r) => !r.url && r.file) ?? [];

  // Changes only when encryption is toggled, so the listeners below stay put.
  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const tooBig = incoming.filter((f) => !fitsUploadLimit(f.size, encryptionOn));
    const accepted = incoming.filter((f) => fitsUploadLimit(f.size, encryptionOn));

    if (accepted.length > 0) {
      setFiles((prev) => {
        const next = [...prev];
        for (const f of accepted) {
          if (!next.some((x) => x.name === f.name && x.size === f.size)) {
            next.push(f);
          }
        }
        return next;
      });
      setResults(null);
    }
    setNotice(null);
    setError(
      tooBig.length === 0
        ? null
        : tooBig.length === 1
        ? `${tooBig[0].name} (${formatFileSize(tooBig[0].size)}) is over the 100MB limit.`
        : `These files are over the 100MB limit: ${tooBig
            .map((f) => `${f.name} (${formatFileSize(f.size)})`)
            .join(', ')}.`
    );
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, [encryptionOn]);

  const onForm = !results && !uploading;

  // Drop anywhere on the page while the upload form is showing.
  useEffect(() => {
    if (!onForm) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setPageDrag(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setPageDrag(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Also stops the hidden file input from taking the drop itself.
      e.preventDefault();
      depth = 0;
      setPageDrag(false);
      addFiles(e.dataTransfer?.files ?? null);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onForm, addFiles]);

  // Paste files (e.g. a screenshot) while the upload form is showing.
  // Text pastes are left alone.
  useEffect(() => {
    if (!onForm) return;
    const onPaste = (e: ClipboardEvent) => {
      const pasted = e.clipboardData?.files;
      if (!pasted || pasted.length === 0) return;
      e.preventDefault();
      addFiles(pasted);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onForm, addFiles]);

  // Leaving the page mid-upload: stop the transfer instead of letting it run
  // on with nothing left on screen to show the result.
  useEffect(() => () => abortRef.current?.abort(), []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
  };

  const handleUpload = async (toUpload: File[] = files) => {
    if (toUpload.length === 0 || maxDownloadsError) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setCancelRequested(false);
    setUploading(true);
    setError(null);
    setSignInNeeded(false);
    setNotice(null);
    setAutoCopied(false);
    setUploadingNames(toUpload.map((f) => f.name));
    setUploadProgress({ stage: 'preparing', percent: 0 });

    const total = toUpload.length;
    const collected: UploadedLink[] = [];
    const shouldEncrypt = encryptionOn;
    // Set when the server says the session expired: every later file would
    // fail the same way, so they are skipped with the same message.
    let signInError: string | null = null;

    for (let i = 0; i < total; i++) {
      const file = toUpload[i];
      if (controller.signal.aborted) {
        collected.push({ name: file.name, error: CANCELLED_MESSAGE, file });
        continue;
      }
      if (signInError) {
        collected.push({ name: file.name, error: signInError, file, signInRequired: true });
        continue;
      }
      // Encryption may have been switched on after the file was added.
      if (!fitsUploadLimit(file.size, shouldEncrypt)) {
        collected.push({
          name: file.name,
          error: `${file.name} is over the 100MB limit once encrypted. Turn off encryption or pick a smaller file.`,
          file,
        });
        continue;
      }
      setCurrentFileIndex(i);
      // Map this file's 0-100 progress onto the overall bar.
      const overall = (percent: number) => ((i + percent / 100) / total) * 100;

      try {
        let fileData: Blob = file;
        let encryptionKey: string | null = null;

        // Encrypt file if enabled — each file gets its own key.
        if (shouldEncrypt) {
          setUploadProgress({ stage: 'encrypting', percent: overall(10) });

          const key = await generateKey();
          encryptionKey = await exportKey(key);

          const fileArrayBuffer = await file.arrayBuffer();
          setUploadProgress({ stage: 'encrypting', percent: overall(30) });

          const encryptedData = await encryptFile(fileArrayBuffer, key);
          fileData = new Blob([encryptedData], { type: 'application/octet-stream' });
        }

        const basePercent = shouldEncrypt ? 55 : 10;
        setUploadProgress({ stage: 'uploading', percent: overall(basePercent) });

        // Direct-to-R2: the server approves the upload, the browser sends the
        // bytes straight to storage (no hosting body-size cap), then the
        // server checks the stored object and creates the share link.
        const result = await directUpload({
          presignUrl: '/api/upload/presign',
          presignBody: {
            originalName: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: fileData.size,
            isEncrypted: shouldEncrypt,
            expiresInHours: expiryHours || null,
            maxDownloads: maxDownloads || null,
            // The form shows member options: if the server no longer sees a
            // session it refuses (401) rather than making a 24h guest file.
            asMember: isAuthenticated,
          },
          blob: fileData,
          completeUrl: '/api/upload/complete',
          completeBody: (ticket) => ({ ticket }),
          signal: controller.signal,
          onProgress: (progress) => {
            const filePercent = basePercent + (progress * (100 - basePercent)) / 100;
            setUploadProgress({ stage: 'uploading', percent: overall(filePercent) });
          },
        });

        if (result.success && typeof result.shareUrl === 'string') {
          // Append encryption key to URL fragment if encrypted
          collected.push({
            name: file.name,
            url: encryptionKey ? `${result.shareUrl}#${encryptionKey}` : result.shareUrl,
            encrypted: shouldEncrypt,
          });
        } else if (result.signInRequired === true) {
          signInError = result.error || 'Your sign-in has expired. Please sign in again.';
          collected.push({ name: file.name, error: signInError, file, signInRequired: true });
        } else {
          collected.push({ name: file.name, error: result.error || 'Upload failed', file });
        }
      } catch (err) {
        console.error('Upload error:', err);
        collected.push({ name: file.name, error: 'An unexpected error occurred', file });
      }
    }

    if (abortRef.current === controller) abortRef.current = null;
    setSignInNeeded(signInError !== null);
    const merged = [...keptRef.current, ...collected];
    keptRef.current = [];

    if (merged.some((r) => r.url)) {
      setUploadProgress({ stage: 'completed', percent: 100 });
      setResults(merged);
      // One link: put it on the clipboard right away. Some browsers refuse
      // without a fresh click — then the Copy button is still there.
      const only = merged.length === 1 ? merged[0].url : undefined;
      if (only && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(only).then(
          () => setAutoCopied(true),
          () => {}
        );
      }
    } else if (controller.signal.aborted) {
      setUploadProgress({ stage: 'idle', percent: 0 });
      setNotice('Upload cancelled. Your files are still selected.');
    } else {
      setUploadProgress({ stage: 'error', percent: 0 });
      setError(collected[0]?.error || 'Upload failed');
    }

    setUploading(false);
  };

  const handleCancel = () => {
    setCancelRequested(true);
    abortRef.current?.abort();
  };

  // Re-send only the failed files, with the same options. Links that
  // already worked are kept and shown again with the new ones.
  const handleRetryFailed = () => {
    if (!results) return;
    const failedFiles = retryable.map((r) => r.file as File);
    keptRef.current = results.filter((r) => r.url);
    setFiles(failedFiles);
    setResults(null);
    setShowEmailForm(false);
    setEmailSent(false);
    void handleUpload(failedFiles);
  };

  const handleReset = () => {
    setFiles([]);
    setResults(null);
    setError(null);
    setSignInNeeded(false);
    setNotice(null);
    setUploadProgress({ stage: 'idle', percent: 0 });
    setCurrentFileIndex(0);
    setExpiryChoice(null);
    setMaxDownloads('');
    setQrTarget(null);
    setAutoCopied(false);
    setShowEmailForm(false);
    setRecipientEmail('');
    setEmailMessage('');
    setEmailSent(false);
    setEmailSending(false);
    setEmailError(null);
    keptRef.current = [];
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleShare = (r: UploadedLink) => {
    if (!r.url) return;
    // Cancelling the share sheet rejects — nothing to report.
    navigator.share({ title: r.name, url: r.url }).catch(() => {});
  };

  const handleSendEmail = async () => {
    if (!recipientEmail || successful.length === 0) return;

    setEmailSending(true);
    setEmailError(null);

    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipientEmail,
          // The server checks each link and uses the stored file name and
          // encryption flag; `name` is kept for the request shape only.
          files: successful.map((r) => ({ name: r.name, link: r.url })),
          senderName: senderName.trim() || undefined,
          message: emailMessage.trim() || undefined,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setEmailSent(true);
        setShowEmailForm(false);
        setRecipientEmail('');
        setEmailMessage('');
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
  const successCount = successful.length;
  const failedCount = (results?.length ?? 0) - successCount;
  // The results view only renders in the browser, so navigator is safe there.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const progressTotal = uploadingNames.length || files.length;

  return (
    <div className="w-full max-w-xl mx-auto">
      {/* Full-page drop target while dragging files over the window */}
      {pageDrag &&
        onForm &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] pointer-events-none flex items-center justify-center p-6 bg-canvas/80 backdrop-blur-sm animate-fade-in"
            aria-hidden="true"
          >
            <div className="border-beam rounded-3xl px-10 py-12 text-center shadow-[var(--glow)] bg-surface">
              <UploadCloud className="w-10 h-10 mx-auto mb-3 text-brand-text" />
              <p className="text-base sm:text-lg font-semibold text-fg">Drop files to upload</p>
              <p className="text-xs text-fg-faint mt-1">{MAX_SIZE_TEXT}</p>
            </div>
          </div>,
          document.body
        )}

      {!results ? (
        <div className="animate-fade-in">
          <div
            className={`relative rounded-3xl p-7 sm:p-9 md:p-11 text-center transition-all duration-300 ease-out has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-brand ${
              pageDrag
                ? 'border-beam scale-[1.02] shadow-[var(--glow)]'
                : 'border-2 border-dashed border-edge-strong bg-surface/60 hover:border-brand/50 hover:bg-surface shadow-[var(--shadow-card)]'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              onChange={handleChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Select files to upload"
              disabled={uploading}
            />

            {files.length > 0 ? (
              <div className="space-y-2 animate-fade-in-scale text-left">
                {files.map((f, idx) => (
                  <div
                    key={`${f.name}-${f.size}-${idx}`}
                    className="relative z-10 flex items-center gap-3 p-2.5 bg-surface-2 border border-edge rounded-xl"
                  >
                    <span className="inline-flex w-9 h-9 shrink-0 rounded-lg bg-brand/10 text-brand-text items-center justify-center">
                      {f.type.startsWith('image/') ? (
                        <ImageIcon className="w-4 h-4" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg truncate">{f.name}</p>
                      <p className="text-xs text-fg-muted">{formatFileSize(f.size)}</p>
                    </div>
                    {!uploading && (
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        className="inline-flex min-w-10 min-h-10 items-center justify-center shrink-0 text-fg-faint hover:text-danger-text rounded-lg hover:bg-danger/10 transition-colors cursor-pointer"
                        aria-label={`Remove ${f.name}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <p className="text-center text-xs text-fg-faint pt-1 inline-flex w-full items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-success-text" />
                  {files.length} file{files.length > 1 ? 's' : ''} ready — drop, paste or click to add more
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <span className="inline-flex w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-brand/10 text-brand-text items-center justify-center animate-float">
                  <UploadCloud className="w-8 h-8 sm:w-9 sm:h-9" />
                </span>
                <p className="text-fg text-sm sm:text-base font-semibold">
                  Drag and drop files here
                </p>
                <p className="text-xs sm:text-sm text-fg-faint">
                  or click to browse, or paste from your clipboard
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
          {files.length > 0 && !uploading && (
            <div className="mt-4 p-4 sm:p-5 bg-surface border border-edge rounded-2xl space-y-4 animate-fade-in shadow-[var(--shadow-card)]">
              {/* Encryption Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Lock className="w-4 h-4 shrink-0 text-brand-text" />
                  <span id="encryption-label" className="text-sm font-medium text-fg">End-to-end encryption</span>
                  {encryptionOn && (
                    <span className="text-[10px] sm:text-xs px-2 py-0.5 bg-success/10 text-success-text rounded-full font-medium whitespace-nowrap">
                      Secure
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={encryptionOn}
                  aria-labelledby="encryption-label"
                  aria-describedby={!encryptionSupported ? 'encryption-unsupported' : undefined}
                  onClick={() => setEncryptionEnabled(!encryptionEnabled)}
                  disabled={!encryptionSupported}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all duration-300 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    encryptionOn
                      ? 'bg-flow shadow-[var(--glow)]'
                      : 'bg-surface-3'
                  } ${!encryptionSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-300 ${
                      encryptionOn ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {!encryptionSupported && (
                <p id="encryption-unsupported" className="text-xs text-warning-text">
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
                  onChange={(e) => setExpiryChoice(e.target.value)}
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
                  {/* New tab, so the files picked here aren't lost. */}
                  <a
                    href="/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-text hover:underline font-medium"
                  >
                    Sign in
                  </a>{' '}
                  for more expiration options (Never, 30 days). Opens in a new tab, your files stay here.
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
                  max={MAX_DOWNLOADS}
                  step="1"
                  inputMode="numeric"
                  placeholder="Unlimited"
                  value={maxDownloads}
                  onChange={(e) => setMaxDownloads(e.target.value)}
                  aria-invalid={maxDownloadsError ? true : undefined}
                  aria-describedby={maxDownloadsError ? 'maxDownloads-error' : undefined}
                  className={`input-base w-28 text-sm px-3 py-1.5 ${maxDownloadsError ? 'border-danger' : ''}`}
                />
              </div>
              {maxDownloadsError && (
                <p id="maxDownloads-error" className="text-xs text-danger-text" role="alert">
                  {maxDownloadsError}
                </p>
              )}
              {files.length > 1 && (
                <p className="text-xs text-fg-faint">
                  Options apply to every file. Each file gets its own share link.
                </p>
              )}
            </div>
          )}

          {/* Progress Bar */}
          {isActiveUpload && (
            <div className="mt-4 animate-fade-in">
              <ProgressBar
                stage={uploadProgress.stage}
                percent={uploadProgress.percent}
              />
              {progressTotal > 1 && (
                <p className="mt-2 text-xs text-center text-fg-muted">
                  File {Math.min(currentFileIndex + 1, progressTotal)} of {progressTotal}
                  {uploadingNames[currentFileIndex] ? ` — ${uploadingNames[currentFileIndex]}` : ''}
                </p>
              )}
            </div>
          )}

          <div aria-live="polite">
            {error && (
              <div className="mt-4 p-3 sm:p-4 bg-danger/10 border border-danger/20 rounded-2xl animate-fade-in" role="alert">
                <p className="text-xs sm:text-sm text-danger-text font-medium">{error}</p>
                {signInNeeded && <SignInAgainLink />}
                {files.length > 0 && (
                  <p className="text-xs text-danger-text/80 mt-1">
                    Your files and options are kept. Press Upload to try again.
                  </p>
                )}
              </div>
            )}
            {notice && (
              <p className="mt-4 text-xs sm:text-sm text-center text-fg-muted animate-fade-in" role="status">
                {notice}
              </p>
            )}
          </div>

          <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row gap-2 sm:gap-3">
            {uploading ? (
              <Button
                variant="secondary"
                size="lg"
                onClick={handleCancel}
                disabled={cancelRequested}
                className="w-full sm:flex-1"
                title="Stop the upload"
              >
                {cancelRequested ? 'Cancelling...' : 'Cancel'}
              </Button>
            ) : (
              files.length > 0 && (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={handleReset}
                  className="w-full sm:flex-1"
                  title="Remove selected files and start over"
                >
                  Clear
                </Button>
              )
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={() => handleUpload()}
              disabled={files.length === 0 || uploading || !!maxDownloadsError}
              loading={uploading}
              loadingText={
                uploadProgress.stage === 'encrypting'
                  ? 'Encrypting...'
                  : uploadProgress.stage === 'uploading'
                  ? progressTotal > 1
                    ? `Uploading ${Math.min(currentFileIndex + 1, progressTotal)}/${progressTotal}...`
                    : 'Uploading...'
                  : 'Preparing...'
              }
              className="w-full sm:flex-1"
              title={files.length === 0 ? 'Select files first' : 'Upload files and generate share links'}
            >
              Upload &amp; Share
            </Button>
          </div>

          {files.length === 0 && (
            <p className="mt-4 text-xs text-center text-fg-faint">
              Your files will be securely stored and a unique link will be generated for sharing.
              <br />
              By uploading you agree to our{' '}
              <a href="/terms" className="underline hover:text-fg-muted">Terms</a> and{' '}
              <a href="/privacy" className="underline hover:text-fg-muted">Privacy Policy</a>.
            </p>
          )}
        </div>
      ) : (
        <div className="border-flow rounded-3xl p-5 sm:p-6 md:p-8 text-center animate-fade-in-scale shadow-[var(--shadow-card)]">
          <span className="inline-flex w-16 h-16 sm:w-20 sm:h-20 mb-3 sm:mb-4 rounded-full bg-flow text-white items-center justify-center glow-dot animate-pop-in">
            <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10" />
          </span>
          <h3 className="text-lg sm:text-xl font-bold text-fg mb-2" role="status">
            {successCount === 1 && results.length === 1
              ? 'File uploaded successfully!'
              : `${successCount} of ${results.length} files uploaded`}
          </h3>
          <p className="text-xs sm:text-sm text-fg-muted mb-4 sm:mb-6">
            {successCount === 1 && results.length === 1
              ? 'Share this link with anyone to let them download your file.'
              : 'Each file has its own share link.'}
            <br />
            <span className="text-fg-faint">No account required to download.</span>
          </p>

          {successful.some((r) => r.encrypted) && (
            <div className="mb-4 flex items-center justify-center gap-2 text-sm text-brand-text">
              <Lock className="w-4 h-4" />
              <span>End-to-end encrypted — key is in the link. Save it now, it isn&apos;t shown again.</span>
            </div>
          )}

          {failedCount > 0 && (
            <div className="mb-3 flex flex-col sm:flex-row items-center justify-center gap-2">
              <p className="text-xs text-danger-text flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                {failedCount} file{failedCount > 1 ? 's' : ''} not uploaded
              </p>
              {signInNeeded && <SignInAgainLink />}
              {retryable.length > 0 && (
                <button
                  type="button"
                  onClick={handleRetryFailed}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand/10 text-brand-text hover:bg-brand/20 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Retry failed
                </button>
              )}
            </div>
          )}

          <div className="space-y-2 text-left">
            {results.map((r, i) => (
              <div
                key={`${r.name}-${i}`}
                className="p-3 bg-surface-2 border border-edge rounded-2xl"
              >
                {results.length > 1 && (
                  <p className="text-xs font-medium text-fg truncate mb-1.5">{r.name}</p>
                )}
                {r.url ? (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={r.url}
                      readOnly
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 text-xs sm:text-sm text-fg-muted bg-transparent outline-none truncate text-center sm:text-left py-2 sm:py-0"
                      aria-label={`Share link for ${r.name}`}
                    />
                    <div className="flex gap-2 justify-center sm:justify-end">
                      <CopyButton text={r.url} />
                      {canShare && (
                        <button
                          type="button"
                          onClick={() => handleShare(r)}
                          className="px-3 py-1.5 text-sm bg-surface border border-edge text-fg-muted rounded-lg hover:bg-surface-3 hover:text-fg transition-colors cursor-pointer flex items-center gap-1.5"
                          title="Share link"
                        >
                          <Share2 className="w-4 h-4" />
                          <span>Share</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setQrTarget(r)}
                        className="px-3 py-1.5 text-sm bg-surface border border-edge text-fg-muted rounded-lg hover:bg-surface-3 hover:text-fg transition-colors cursor-pointer flex items-center gap-1.5"
                        title="Show QR Code"
                      >
                        <QrCode className="w-4 h-4" />
                        <span>QR</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-danger-text flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {r.error || 'Upload failed'}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div aria-live="polite">
            {autoCopied && (
              <p className="mt-3 text-xs text-success-text flex items-center justify-center gap-1.5 animate-fade-in">
                <Check className="w-3.5 h-3.5" /> Link copied to your clipboard
              </p>
            )}
          </div>

          {successCount > 1 && (
            <button
              type="button"
              onClick={() =>
                copyAll(successful.map((r) => `${r.name}: ${r.url}`).join('\n'))
              }
              className={`mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-xl transition-colors cursor-pointer text-sm font-medium ${
                allCopied
                  ? 'bg-success/15 text-success-text border-success/20'
                  : 'bg-surface border-edge text-fg-muted hover:bg-surface-2 hover:text-fg'
              }`}
              aria-live="polite"
            >
              {allCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {allCopied ? 'All links copied' : `Copy all ${successCount} links`}
            </button>
          )}

          {!isAuthenticated && (
            <p className="mt-3 text-xs text-fg-faint">
              Tip: Sign in to manage your uploads and track download activity.
            </p>
          )}

          {/* Email Sharing Section — all links in one email */}
          {successCount > 0 && (
            !showEmailForm ? (
              <button
                onClick={() => { setShowEmailForm(true); setEmailError(null); setEmailSent(false); }}
                disabled={emailSending}
                className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-surface border border-edge text-fg-muted rounded-xl hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer text-sm font-medium"
              >
                <Mail className="w-4 h-4" />
                {successCount > 1 ? `Send all ${successCount} links via email` : 'Send via Email'}
              </button>
            ) : (
              <div className="mt-4 p-4 bg-surface border border-edge rounded-2xl animate-fade-in text-left space-y-3">
                <div>
                  <label htmlFor="recipientEmail" className="block text-sm font-medium text-fg mb-1.5">
                    Recipient&apos;s email address
                  </label>
                  <input
                    id="recipientEmail"
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="recipient@example.com"
                    disabled={emailSending}
                    className="input-base w-full px-3 py-2 text-sm disabled:opacity-60"
                  />
                </div>
                <div>
                  <label htmlFor="senderName" className="block text-sm font-medium text-fg mb-1.5">
                    Your name <span className="text-fg-faint font-normal">(optional)</span>
                  </label>
                  <input
                    id="senderName"
                    type="text"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    maxLength={80}
                    autoComplete="name"
                    placeholder="So they know who sent it"
                    disabled={emailSending}
                    className="input-base w-full px-3 py-2 text-sm disabled:opacity-60"
                  />
                </div>
                <div>
                  <label htmlFor="emailMessage" className="block text-sm font-medium text-fg mb-1.5">
                    Message <span className="text-fg-faint font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="emailMessage"
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder="Here are the files we talked about."
                    disabled={emailSending}
                    className="input-base w-full px-3 py-2 text-sm resize-y disabled:opacity-60"
                  />
                </div>
                <div aria-live="polite">
                  {emailError && (
                    <p className="text-xs text-danger-text" role="alert">{emailError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
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
                  <button
                    onClick={() => { setShowEmailForm(false); setEmailError(null); }}
                    disabled={emailSending}
                    className="px-3 py-2 text-sm text-fg-faint hover:text-fg-muted cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )
          )}

          <div aria-live="polite">
            {emailSent && (
              <p className="mt-3 text-xs text-success-text flex items-center justify-center gap-1.5 animate-fade-in">
                <CheckCircle2 className="w-3.5 h-3.5" /> Email sent successfully!
              </p>
            )}
          </div>

          <button
            onClick={handleReset}
            className="mt-4 sm:mt-6 text-sm text-brand-text hover:underline cursor-pointer transition-colors duration-200 font-medium"
          >
            Upload more files
          </button>
        </div>
      )}

      {/* QR Modal */}
      <QRModal
        isOpen={qrTarget !== null}
        onClose={() => setQrTarget(null)}
        url={qrTarget?.url || ''}
        fileName={qrTarget?.name || ''}
      />
    </div>
  );
}
