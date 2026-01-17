'use client';

import { useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
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
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl p-5 sm:p-6 md:p-8 max-w-sm w-full shadow-xl animate-fade-in-scale">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
          aria-label="Close modal"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <h2 id="qr-modal-title" className="text-lg sm:text-xl font-semibold text-gray-900 mb-1 pr-8">
          Scan to Download
        </h2>
        <p className="text-xs sm:text-sm text-gray-500 mb-4 sm:mb-6 truncate" title={fileName}>
          {fileName}
        </p>

        {/* QR Code */}
        <div className="flex justify-center mb-4 sm:mb-6">
          <div className="p-3 sm:p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
            <QRCodeSVG
              value={url}
              size={180}
              level="M"
              includeMargin={false}
              className="w-[140px] h-[140px] sm:w-[180px] sm:h-[180px]"
            />
          </div>
        </div>

        {/* URL display and copy */}
        <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <input
            type="text"
            value={url}
            readOnly
            className="flex-1 text-xs text-gray-600 bg-transparent outline-none truncate"
            aria-label="Share URL"
          />
          <CopyButton text={url} />
        </div>

        <p className="mt-3 sm:mt-4 text-[10px] sm:text-xs text-gray-400 text-center">
          Point your phone camera at the QR code to download
        </p>
      </div>
    </div>
  );
}
