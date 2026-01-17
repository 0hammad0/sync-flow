'use client';

import { useState } from 'react';

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
      className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 cursor-pointer btn-hover whitespace-nowrap ${
        copied
          ? 'bg-green-100 text-green-700'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
      title={copied ? 'Link copied to clipboard!' : 'Copy share link to clipboard'}
      aria-label={copied ? 'Link copied' : 'Copy link'}
    >
      {copied ? '✓ Copied!' : 'Copy'}
    </button>
  );
}
