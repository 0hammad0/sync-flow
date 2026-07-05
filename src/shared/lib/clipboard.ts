'use client';

import { useState } from 'react';

/**
 * Copy text to the clipboard, falling back to a hidden textarea +
 * execCommand when the async Clipboard API is unavailable (insecure
 * context, older browsers).
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/**
 * Copy-with-feedback: returns a `copied` flag that flips true for `resetMs`
 * after a successful copy. Used by every copy button in the app.
 */
export function useCopy(resetMs = 2000): {
  copied: boolean;
  copy: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), resetMs);
  };
  return { copied, copy };
}
