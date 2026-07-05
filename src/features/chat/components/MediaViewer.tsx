'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, FileText, X } from 'lucide-react';
import { formatFileSize } from '@/shared/lib/utils';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import { attachmentViewUrl, previewKind } from '@/features/chat/lib/chat-helpers';
import type { ChatAttachment } from '@/types';

// Full-screen lightbox for chat attachments: images, PDFs (iframe), and
// DOCX (client-side mammoth preview). Keyboard-navigable across an album.
export function MediaViewer({
  items,
  activeKey,
  roomCode,
  onClose,
  onNavigate,
}: {
  items: { att: ChatAttachment; sender: string }[];
  activeKey: string;
  roomCode: string;
  onClose: () => void;
  onNavigate: (attachmentKey: string) => void;
}) {
  const index = items.findIndex((it) => it.att.key === activeKey);
  const current = index >= 0 ? items[index] : null;
  const prevKey = index > 0 ? items[index - 1].att.key : null;
  const nextKey = index >= 0 && index < items.length - 1 ? items[index + 1].att.key : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && prevKey) onNavigate(prevKey);
      else if (e.key === 'ArrowRight' && nextKey) onNavigate(nextKey);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = 'unset';
    };
  }, [onClose, onNavigate, prevKey, nextKey]);

  if (!current) return null;
  const att = current.att;
  const kind = previewKind(att);
  const viewUrl = attachmentViewUrl(roomCode, att.key);

  // Portal to <body>: the chat wrapper's fade-in animation retains a
  // transform, which would otherwise trap this "fixed" overlay inside it.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/90 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`Viewing ${att.name}`}
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{att.name}</p>
          <p className="text-xs text-gray-400 truncate">
            {current.sender} · {formatFileSize(att.size)}
            {items.length > 1 && ` · ${index + 1} / ${items.length}`}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={`${viewUrl}&download=1`}
            className="p-2 text-gray-300 hover:text-white rounded-lg hover:bg-white/10"
            title="Download"
            aria-label="Download"
          >
            <Download className="w-5 h-5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-300 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer"
            title="Close (Esc)"
            aria-label="Close viewer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-16 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {prevKey && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(prevKey);
            }}
            className="absolute left-1 sm:left-4 z-10 p-2 sm:p-2.5 text-white bg-black/40 sm:bg-white/10 hover:bg-white/25 rounded-full cursor-pointer"
            title="Previous (←)"
            aria-label="Previous attachment"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        <div
          className="w-full h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element -- R2-redirect src
            <img
              key={att.key}
              src={viewUrl}
              alt={att.name}
              className="max-h-full max-w-full object-contain rounded animate-fade-in-scale"
            />
          ) : kind === 'pdf' ? (
            <iframe
              key={att.key}
              src={viewUrl}
              title={att.name}
              className="w-full h-full max-w-4xl bg-white rounded-lg"
            />
          ) : (
            <DocxPreview key={att.key} url={viewUrl} downloadUrl={`${viewUrl}&download=1`} />
          )}
        </div>

        {nextKey && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(nextKey);
            }}
            className="absolute right-1 sm:right-4 z-10 p-2 sm:p-2.5 text-white bg-black/40 sm:bg-white/10 hover:bg-white/25 rounded-full cursor-pointer"
            title="Next (→)"
            aria-label="Next attachment"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

// Client-side DOCX preview via mammoth (dynamic import — only loaded when a
// .docx is actually opened; the document never leaves your storage).
function DocxPreview({ url, downloadUrl }: { url: string; downloadUrl: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ default: mammoth }, res] = await Promise.all([
          import('mammoth'),
          fetch(url),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        // Sanitize before dangerouslySetInnerHTML: a malicious docx could
        // smuggle scripts, on* handlers, or javascript: links into the HTML.
        const doc = new DOMParser().parseFromString(result.value, 'text/html');
        doc.querySelectorAll('script, iframe, object, embed, style, link').forEach((el) => el.remove());
        doc.querySelectorAll('*').forEach((el) => {
          for (const attr of Array.from(el.attributes)) {
            if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
          }
        });
        doc.querySelectorAll('a[href]').forEach((a) => {
          const href = (a.getAttribute('href') || '').trim();
          if (!/^(https?:|mailto:|#)/i.test(href)) {
            a.removeAttribute('href');
          } else {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
          }
        });
        doc.querySelectorAll('img').forEach((img) => {
          const src = img.getAttribute('src') || '';
          if (!/^data:image\//i.test(src)) img.remove();
        });
        if (!cancelled) setHtml(doc.body.innerHTML);
      } catch (err) {
        console.error('DOCX preview error:', err);
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <div className="text-center">
        <FileText className="w-10 h-10 mx-auto mb-3 text-gray-400" />
        <p className="text-sm text-gray-200 mb-3">Preview not available for this document.</p>
        <a
          href={downloadUrl}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-100"
        >
          <Download className="w-4 h-4" />
          Download instead
        </a>
      </div>
    );
  }
  if (html === null) {
    return (
      <div className="flex flex-col items-center gap-3 text-gray-300">
        <LoadingSpinner size="lg" className="text-white" />
        <span className="text-xs">Preparing preview…</span>
      </div>
    );
  }
  return (
    <div className="w-full h-full max-w-3xl overflow-y-auto bg-white rounded-lg">
      <div
        className="docx-preview px-6 sm:px-10 py-8 text-sm text-gray-900 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mb-2 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:border-collapse [&_td]:border [&_td]:border-gray-300 [&_td]:px-2 [&_td]:py-1 [&_img]:max-w-full"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
