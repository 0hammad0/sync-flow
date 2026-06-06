'use client';

import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { X } from 'lucide-react';
import CopyButton from './CopyButton';

interface QRModalProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
  fileName: string;
}

export default function QRModal({ isOpen, onClose, url, fileName }: QRModalProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    // Early return matters: without it the cleanup runs on every parent
    // re-render even while CLOSED, resetting body overflow set by others.
    if (!isOpen) return;
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  // Portal to <body>: ancestors with transforms (e.g. fade-in animations)
  // would otherwise become the containing block and mis-position fixed
  // overlays below the sticky header.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-surface border border-edge rounded-3xl p-5 sm:p-6 md:p-8 max-w-sm w-full shadow-2xl animate-fade-in-scale">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-2 text-fg-faint hover:text-fg rounded-lg hover:bg-surface-2 transition-colors cursor-pointer"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 id="qr-modal-title" className="text-lg sm:text-xl font-bold text-fg mb-1 pr-8">
          Scan to Download
        </h2>
        <p className="text-xs sm:text-sm text-fg-muted mb-4 sm:mb-6 truncate" title={fileName}>
          {fileName}
        </p>

        {/* QR Code — framed with the brand gradient */}
        <div className="flex justify-center mb-4 sm:mb-6">
          <div className="p-[2px] bg-flow rounded-2xl glow-dot">
            <div className="p-3 sm:p-4 bg-white rounded-[calc(1rem-2px)]">
              <QRCodeSVG
                value={url}
                size={180}
                level="M"
                includeMargin={false}
                className="w-[140px] h-[140px] sm:w-[180px] sm:h-[180px]"
              />
            </div>
          </div>
        </div>

        {/* URL display and copy */}
        <div className="flex items-center gap-2 p-3 bg-surface-2 border border-edge rounded-2xl">
          <input
            type="text"
            value={url}
            readOnly
            // 16px on mobile so tapping it doesn't trigger iOS focus-zoom
            className="flex-1 text-base sm:text-xs text-fg-muted bg-transparent outline-none truncate"
            aria-label="Share URL"
          />
          <CopyButton text={url} />
        </div>

        <p className="mt-3 sm:mt-4 text-[10px] sm:text-xs text-fg-faint text-center">
          Point your phone camera at the QR code to download
        </p>
      </div>
    </div>,
    document.body
  );
}
