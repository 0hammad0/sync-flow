'use client';

import { useState, useRef, use } from 'react';
import { formatFileSize } from '@/lib/utils';
import LoadingSpinner from '@/components/LoadingSpinner';
import Button from '@/components/ui/Button';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  File as FileIcon,
  Image as ImageIcon,
  Film,
  MonitorSmartphone,
  Plus,
  UploadCloud,
  X,
} from 'lucide-react';

interface SendPageProps {
  params: Promise<{ sessionToken: string }>;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024;

type ItemStatus = 'pending' | 'uploading' | 'done' | 'error';
interface Item {
  file: File;
  status: ItemStatus;
  progress: number;
  error?: string;
}

function ItemIcon({ file, className }: { file: File; className: string }) {
  if (file.type.startsWith('image/')) return <ImageIcon className={className} />;
  if (file.type.startsWith('video/')) return <Film className={className} />;
  return <FileIcon className={className} />;
}

export default function SendPage({ params }: SendPageProps) {
  const { sessionToken } = use(params);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pending = items.filter((i) => i.status === 'pending');
  const doneCount = items.filter((i) => i.status === 'done').length;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setItems((prev) => {
      const known = new Set(prev.map((i) => `${i.file.name}:${i.file.size}`));
      const fresh = picked
        .filter((f) => !known.has(`${f.name}:${f.size}`))
        .map<Item>((f) => ({
          file: f,
          status: f.size === 0 || f.size > MAX_FILE_SIZE ? 'error' : 'pending',
          progress: 0,
          error:
            f.size === 0
              ? 'Empty file'
              : f.size > MAX_FILE_SIZE
                ? `${formatFileSize(f.size)} — over the 100 MB limit`
                : undefined,
        }));
      return [...prev, ...fresh];
    });
    e.target.value = '';
  };

  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const setItem = (idx: number, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const uploadOne = (item: Item, idx: number) =>
    new Promise<void>((resolve) => {
      const formData = new FormData();
      formData.append('file', item.file);
      formData.append('originalName', item.file.name);
      formData.append('mimeType', item.file.type || 'application/octet-stream');
      formData.append('isEncrypted', 'false');
      formData.append('sessionToken', sessionToken);

      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setItem(idx, { progress: Math.round((e.loaded / e.total) * 100) });
        }
      });
      xhr.addEventListener('load', () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && res.success) {
            setItem(idx, { status: 'done', progress: 100 });
          } else if (res.error === 'Session expired') {
            setExpired(true);
            setItem(idx, { status: 'error', error: 'Session expired' });
          } else {
            setItem(idx, { status: 'error', error: res.error || `HTTP ${xhr.status}` });
          }
        } catch {
          setItem(idx, { status: 'error', error: 'Invalid server response' });
        }
        resolve();
      });
      xhr.addEventListener('error', () => {
        setItem(idx, { status: 'error', error: 'Network error' });
        resolve();
      });
      xhr.open('POST', '/api/send');
      xhr.send(formData);
    });

  // Sequential uploads — each file appears on the PC the moment it lands.
  const handleUpload = async () => {
    if (busy) return;
    setBusy(true);
    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== 'pending' || expired) continue;
      setItem(i, { status: 'uploading', progress: 0 });
      await uploadOne(items[i], i);
    }
    setBusy(false);
  };

  if (expired && doneCount === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-surface border border-edge rounded-3xl p-6 text-center animate-fade-in">
          <span className="inline-flex w-16 h-16 mb-4 rounded-3xl bg-surface-2 border border-edge text-fg-faint items-center justify-center">
            <Clock className="w-8 h-8" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">Session Expired</h1>
          <p className="text-sm text-fg-muted">
            This upload link has expired. Please scan a new QR code from the computer.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm w-full animate-fade-in">
        <div className="text-center mb-6">
          <span className="inline-flex w-12 h-12 mb-3 rounded-2xl bg-brand/10 text-brand-text items-center justify-center">
            <MonitorSmartphone className="w-6 h-6" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-1">Send to Computer</h1>
          <p className="text-sm text-fg-muted">
            Select one or more files — they appear on your computer as each finishes
          </p>
        </div>

        <div className="bg-surface border border-edge rounded-3xl p-5 shadow-[var(--shadow-card)]">
          {/* Picker */}
          <div className="relative border-2 border-dashed rounded-2xl p-5 text-center transition-colors border-edge-strong">
            <input
              ref={inputRef}
              type="file"
              multiple
              onChange={handleChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={busy}
              aria-label="Select files to send"
            />
            <div className="space-y-1.5">
              <span className="inline-flex w-12 h-12 rounded-2xl bg-brand/10 text-brand-text items-center justify-center animate-float">
                {items.length === 0 ? <UploadCloud className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
              </span>
              <p className="text-sm text-fg font-medium">
                {items.length === 0 ? 'Tap to select files' : 'Add more files'}
              </p>
              <p className="text-xs text-fg-faint">Multiple allowed · 100MB each</p>
            </div>
          </div>

          {/* File list */}
          {items.length > 0 && (
            <ul className="mt-4 space-y-2">
              {items.map((item, idx) => (
                <li
                  key={`${item.file.name}:${item.file.size}`}
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
                          ? `${item.progress}%`
                          : item.status === 'done'
                            ? 'Sent'
                            : formatFileSize(item.file.size)}
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
                  {item.status === 'pending' && !busy && (
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
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

          {/* Action */}
          <div className="mt-4 space-y-2">
            {pending.length > 0 && !busy && (
              <Button variant="primary" size="lg" fullWidth onClick={handleUpload}>
                Send {pending.length > 1 ? `${pending.length} files` : 'to Computer'}
              </Button>
            )}
            {busy && (
              <button
                disabled
                className="w-full py-3 bg-surface-3 text-fg-faint font-medium rounded-xl cursor-not-allowed flex items-center justify-center gap-2"
              >
                <LoadingSpinner size="sm" className="text-fg-faint" />
                <span>Sending…</span>
              </button>
            )}
            {doneCount > 0 && pending.length === 0 && !busy && (
              <p className="text-center text-sm text-success-text font-medium flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                {doneCount} {doneCount === 1 ? 'file' : 'files'} sent — add more or close this page
              </p>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-fg-faint text-center">
          Files appear on your computer automatically as each one finishes
        </p>
      </div>
    </div>
  );
}
