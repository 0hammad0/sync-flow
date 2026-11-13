'use client';

import { useSyncExternalStore, type CSSProperties } from 'react';
import { Toaster as SonnerToaster } from 'sonner';

// Theme follows the `.dark` class the site's head script sets (sf-theme).
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
const getTheme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

// Phones (< 640) and landscape phones (`short:`) get top-center toasts.
const PHONE = '(max-width: 639px)';
const SHORT = '(max-height: 500px) and (orientation: landscape)';
function subscribeMedia(onChange: () => void) {
  const queries = [window.matchMedia(PHONE), window.matchMedia(SHORT)];
  queries.forEach((q) => q.addEventListener('change', onChange));
  return () => queries.forEach((q) => q.removeEventListener('change', onChange));
}
// One string so the snapshot is stable between renders.
const getLayout = () =>
  window.matchMedia(SHORT).matches ? 'short' : window.matchMedia(PHONE).matches ? 'phone' : 'wide';

const TOKENS = {
  '--normal-bg': 'var(--surface)',
  '--normal-border': 'var(--edge)',
  '--normal-text': 'var(--fg)',
  '--border-radius': '0.5rem',
  fontFamily: 'var(--font-sans), system-ui, sans-serif',
} as CSSProperties;

/**
 * sonner's toaster styled with the site tokens. Mount once, in the admin
 * shell only (never on public pages: it would add sonner to their bundle).
 */
export default function Toaster() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as const);
  const layout = useSyncExternalStore(subscribeMedia, getLayout, () => 'wide' as const);

  return (
    <SonnerToaster
      theme={theme}
      position={layout === 'wide' ? 'bottom-right' : 'top-center'}
      visibleToasts={layout === 'short' ? 2 : 3}
      closeButton
      style={TOKENS}
      toastOptions={{ style: { boxShadow: 'var(--shadow-float)', fontSize: '0.875rem' } }}
    />
  );
}
