'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  text: string;
}

export default function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 cursor-pointer btn-hover whitespace-nowrap inline-flex items-center gap-1.5 ${
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
          Copied!
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          Copy
        </>
      )}
    </button>
  );
}
