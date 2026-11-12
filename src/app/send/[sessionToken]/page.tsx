'use client';

import { useState, useRef, useEffect, use } from 'react';
import Link from 'next/link';
import { formatFileSize } from '@/shared/lib/utils';
import { directUpload } from '@/shared/lib/direct-upload';
import { MAX_UPLOAD_BYTES } from '@/shared/lib/limits';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import Button from '@/shared/components/ui/Button';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Film,
  MonitorSmartphone,
  Plus,
  RotateCw,
  Type,
  UploadCloud,
  X,
} from 'lucide-react';

interface SendPageProps {
  params: Promise<{ sessionToken: string }>;
}

const EXPIRED_MESSAGE = 'Not sent — link expired';

type ItemStatus = 'pending' | 'uploading' | 'done' | 'error';
interface Item {
  id: number;
  file: File;
  status: ItemStatus;
  progress: number;
  error?: string;
  // False for files that can never go through (empty, too large).
  retryable: boolean;
}

type Phase = 'checking' | 'ready' | 'expired' | 'notfound';

function ItemIcon({ file, className }: { file: File; className: string }) {
  if (file.type.startsWith('image/')) return <ImageIcon className={className} />;
  if (file.type.startsWith('video/')) return <Film className={className} />;
  if (file.type.startsWith('text/plain')) return <FileText className={className} />;
  return <FileIcon className={className} />;
}

function noteName(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `note-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.txt`;
}

/** Is the receive session still open? Network errors count as "maybe" — uploads will tell. */
async function checkSession(sessionToken: string): Promise<'ready' | 'expired' | 'notfound'> {
  try {
    const res = await fetch(`/api/receive/${encodeURIComponent(sessionToken)}?peek=1`, { cache: 'no-store' });
    if (res.status === 404) return 'notfound';
    if (res.status === 410) return 'expired';
  } catch {
    // offline — let the upload report it
  }
  return 'ready';
}

export default function SendPage({ params }: SendPageProps) {
  const { sessionToken } = use(params);
  const [phase, setPhase] = useState<Phase>('checking');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  // Set when the session ends mid-batch; already-sent items stay listed.
  const [expired, setExpired] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [tab, setTab] = useState<'files' | 'text'>('files');
  const [text, setText] = useState('');

  // The upload loop reads these refs, not state, so it always sees the
  // latest list and expiry (state captured in a closure goes stale).
  const itemsRef = useRef<Item[]>([]);
  const expiredRef = useRef(false);
  const runningRef = useRef(false);
  const nextId = useRef(0);

  // Check the link as soon as the page opens, not after files are picked.
  useEffect(() => {
    let cancelled = false;
    void checkSession(sessionToken).then((result) => {
      if (!cancelled) setPhase(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  const update = (fn: (prev: Item[]) => Item[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  };

  const patch = (id: number, p: Partial<Item>) =>
    update((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const markExpired = () => {
    expiredRef.current = true;
    setExpired(true);
    update((prev) =>
      prev.map((it) => (it.status === 'pending' ? { ...it, status: 'error', error: EXPIRED_MESSAGE } : it))
    );
  };

  // Direct-to-R2 (presign → PUT → complete) so files over the hosting
  // body cap (~4.5 MB on Vercel) still go through.
  const uploadOne = async (item: Item) => {
    const res = await directUpload({
      presignUrl: '/api/send/presign',
      presignBody: {
        sessionToken,
        originalName: item.file.name,
        mimeType: item.file.type || 'application/octet-stream',
        size: item.file.size,
      },
      blob: item.file,
      completeUrl: '/api/send/complete',
      completeBody: (ticket) => ({ ticket }),
      onProgress: (percent) => patch(item.id, { progress: percent }),
    });
    if (res.success) {
      patch(item.id, { status: 'done', progress: 100 });
    } else if (res.error === 'Session expired' || res.error === 'Session not found') {
      patch(item.id, { status: 'error', error: EXPIRED_MESSAGE });
      markExpired();
    } else {
      patch(item.id, { status: 'error', error: res.error || 'Upload failed' });
    }
  };

  // Sequential uploads, started as soon as something is queued — each file
  // appears on the PC the moment it lands.
  const pump = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    try {
      for (;;) {
        if (expiredRef.current) break;
        const next = itemsRef.current.find((i) => i.status === 'pending');
        if (!next) break;
        patch(next.id, { status: 'uploading', progress: 0 });
        await uploadOne(next);
      }
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  };

  const addFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    update((prev) => {
      // Skip exact repeats that are queued or sent; a re-picked failed file replaces its old row.
      const key = (f: File) => `${f.name}:${f.size}`;
      const live = new Set(prev.filter((i) => i.status !== 'error').map((i) => key(i.file)));
      const fresh = picked
        .filter((f) => !live.has(key(f)))
        .map<Item>((f) => {
          const invalid =
            f.size === 0
              ? 'Empty file'
              : f.size > MAX_UPLOAD_BYTES
                ? `${formatFileSize(f.size)} — over the ${formatFileSize(MAX_UPLOAD_BYTES)} limit`
                : undefined;
          return {
            id: nextId.current++,
            file: f,
            status: invalid || expiredRef.current ? 'error' : 'pending',
            progress: 0,
            error: invalid ?? (expiredRef.current ? EXPIRED_MESSAGE : undefined),
            retryable: !invalid,
          };
        });
      const replaced = new Set(fresh.map((i) => key(i.file)));
      return [...prev.filter((i) => !(i.status === 'error' && replaced.has(key(i.file)))), ...fresh];
    });
    void pump();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const sendText = () => {
    if (!text.trim()) return;
    addFiles([new File([text], noteName(), { type: 'text/plain' })]);
    setText('');
  };

  const retry = (id: number) => {
    patch(id, { status: 'pending', progress: 0, error: undefined });
    void pump();
  };

  const removeItem = (id: number) => update((prev) => prev.filter((it) => it.id !== id));

  // After the computer extends the session, pick up where the batch stopped.
  const recheck = async () => {
    setRechecking(true);
    const result = await checkSession(sessionToken);
    setRechecking(false);
    if (result === 'notfound') setPhase('notfound');
    if (result !== 'ready') return;
    setPhase('ready');
    expiredRef.current = false;
    setExpired(false);
    update((prev) =>
      prev.map((it) => (it.error === EXPIRED_MESSAGE ? { ...it, status: 'pending', error: undefined } : it))
    );
    void pump();
  };

  const doneCount = items.filter((i) => i.status === 'done').length;
  const queued = items.filter((i) => i.status === 'pending' || i.status === 'uploading').length;
  const failedCount = items.filter((i) => i.status === 'error').length;

  if (phase === 'checking') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-3">
        <LoadingSpinner size="lg" className="text-brand-text" />
        <p className="text-sm text-fg-muted">Connecting to your computer…</p>
      </div>
    );
  }

  if (phase === 'expired' || phase === 'notfound' || (expired && doneCount === 0)) {
    const notFound = phase === 'notfound';
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-surface border border-edge rounded-3xl p-6 text-center animate-fade-in">
          <span className="inline-flex w-16 h-16 mb-4 rounded-3xl bg-surface-2 border border-edge text-fg-faint items-center justify-center">
            {notFound ? <AlertCircle className="w-8 h-8" /> : <Clock className="w-8 h-8" />}
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">
            {notFound ? 'Link not found' : 'Link expired'}
          </h1>
          <p className="text-sm text-fg-muted mb-5">
            {notFound
              ? 'This link isn’t valid. Scan the QR code on your computer again.'
              : 'Tap “Extend 10 min” or “New session” on your computer, then scan the code again.'}
          </p>
          {!notFound && (
            <Button variant="secondary" size="md" fullWidth onClick={recheck} loading={rechecking}>
              Try again
            </Button>
          )}
          <Link href="/send" className="mt-3 inline-block text-sm text-brand-text hover:underline">
            Enter a code instead
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm w-full animate-fade-in">
        <div className="text-center mb-5">
          <span className="inline-flex w-12 h-12 mb-3 rounded-2xl bg-brand/10 text-brand-text items-center justify-center">
            <MonitorSmartphone className="w-6 h-6" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-1">Phone → PC</h1>
          <p className="text-sm text-fg-muted">Pick files or paste text — each one goes to your computer right away</p>
        </div>

        {expired && (
          <div
            role="alert"
            className="mb-4 p-3 bg-warning/10 border border-warning/20 rounded-2xl text-sm text-warning-text"
          >
            <p className="font-medium">This link expired</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {doneCount} {doneCount === 1 ? 'item' : 'items'} sent. To send the rest, tap “Extend 10 min” on your
              computer, then try again.
            </p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={recheck} loading={rechecking}>
              Try again
            </Button>
          </div>
        )}

        <div className="bg-surface border border-edge rounded-3xl p-5 shadow-[var(--shadow-card)]">
          {/* Files / Text */}
          <div className="grid grid-cols-2 gap-1 p-1 mb-4 bg-surface-2 border border-edge rounded-xl" role="tablist">
            {(['files', 'text'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg cursor-pointer transition-colors ${
                  tab === t ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {t === 'files' ? <UploadCloud className="w-4 h-4" /> : <Type className="w-4 h-4" />}
                {t === 'files' ? 'Files' : 'Text'}
              </button>
            ))}
          </div>

          {tab === 'files' ? (
            <div className="relative border-2 border-dashed rounded-2xl p-5 text-center transition-colors border-edge-strong">
              <input
                type="file"
                multiple
                onChange={handleChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                disabled={expired}
                aria-label="Select files to send"
              />
              <div className="space-y-1.5">
                <span className="inline-flex w-12 h-12 rounded-2xl bg-brand/10 text-brand-text items-center justify-center animate-float">
                  {items.length === 0 ? <UploadCloud className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                </span>
                <p className="text-sm text-fg font-medium">
                  {items.length === 0 ? 'Tap to pick files' : 'Pick more files'}
                </p>
                <p className="text-xs text-fg-faint">Sending starts right away · {formatFileSize(MAX_UPLOAD_BYTES)} each</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste text or a link"
                rows={5}
                disabled={expired}
                className="input-base w-full px-3 py-2.5 text-base pointer-fine:sm:text-sm resize-y"
                aria-label="Text to send"
              />
              <Button variant="primary" size="lg" fullWidth onClick={sendText} disabled={!text.trim() || expired}>
                Send text
              </Button>
            </div>
          )}

          {/* Status of each item */}
          {items.length > 0 && (
            <ul className="mt-4 space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2.5 p-2.5 bg-surface-2 border border-edge rounded-xl"
                >
                  <span
                    className={`inline-flex w-8 h-8 shrink-0 rounded-lg items-center justify-center ${
                      item.status === 'done'
                        ? 'bg-success/15 text-success-text'
                        : item.status === 'error'
                          ? 'bg-danger/10 text-danger-text'
                          : 'bg-brand/10 text-brand-text'
                    }`}
                  >
                    {item.status === 'done' ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : item.status === 'error' ? (
                      <AlertCircle className="w-4 h-4" />
                    ) : item.status === 'uploading' ? (
                      <LoadingSpinner size="sm" className="text-brand-text" />
                    ) : (
                      <ItemIcon file={item.file} className="w-4 h-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-fg truncate">{item.file.name}</span>
                    <span className={`block text-[10px] ${item.status === 'error' ? 'text-danger-text' : 'text-fg-muted'}`}>
                      {item.status === 'error'
                        ? item.error
                        : item.status === 'uploading'
                          ? `Sending · ${item.progress}%`
                          : item.status === 'done'
                            ? 'Sent'
                            : `Waiting · ${formatFileSize(item.file.size)}`}
                    </span>
                    {item.status === 'uploading' && (
                      <span className="block mt-1 h-1 bg-surface-3 rounded-full overflow-hidden">
                        <span
                          className="block h-full bg-flow rounded-full transition-all duration-200"
                          style={{ width: `${item.progress}%` }}
                        />
                      </span>
                    )}
                  </span>
                  {item.status === 'error' && item.retryable && !expired && (
                    <button
                      type="button"
                      onClick={() => retry(item.id)}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-brand-text rounded-lg hover:bg-brand/10 cursor-pointer"
                      aria-label={`Retry ${item.file.name}`}
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      Retry
                    </button>
                  )}
                  {(item.status === 'pending' || item.status === 'error') && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="p-1 text-fg-faint hover:text-fg cursor-pointer"
                      aria-label={`Remove ${item.file.name}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {doneCount > 0 && queued === 0 && !busy && (
            <p className="mt-4 text-center text-sm text-success-text font-medium flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              {doneCount} sent{failedCount > 0 ? `, ${failedCount} failed` : ''} — add more or close this page
            </p>
          )}
        </div>

        <p className="mt-4 text-xs text-fg-faint text-center">
          Keep this page open until each item shows Sent
        </p>
      </div>
    </div>
  );
}
