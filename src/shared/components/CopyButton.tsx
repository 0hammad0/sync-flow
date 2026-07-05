'use client';

import { Check, Copy } from 'lucide-react';
import { useCopy } from '@/shared/lib/clipboard';

interface CopyButtonProps {
  text: string;
  /** Icon-only on small screens (label appears from `sm:` up). */
  compact?: boolean;
}

export default function CopyButton({ text, compact = false }: CopyButtonProps) {
  const { copied, copy } = useCopy();

  return (
    <button
      onClick={() => copy(text)}
      className={`${compact ? 'px-2 sm:px-4' : 'px-3 sm:px-4'} py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 cursor-pointer btn-hover whitespace-nowrap inline-flex items-center gap-1.5 ${
        copied
          ? 'bg-success/15 text-success-text'
          : 'bg-surface-2 border border-edge text-fg-muted hover:bg-surface-3 hover:text-fg'
      }`}
      title={copied ? 'Link copied to clipboard!' : 'Copy share link to clipboard'}
      aria-label={copied ? 'Link copied' : 'Copy link'}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5" />
          <span className={compact ? 'hidden sm:inline' : ''}>Copied!</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span className={compact ? 'hidden sm:inline' : ''}>Copy</span>
        </>
      )}
    </button>
  );
}
