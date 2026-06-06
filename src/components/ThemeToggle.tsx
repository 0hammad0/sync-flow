'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

const THEME_KEY = 'sf-theme';

// The <html> class list IS the theme store — the inline script in layout.tsx
// sets it before paint. Subscribe via MutationObserver so any toggle
// (this button, another tab via storage, devtools) re-renders us.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains('dark');
}

// Server render: assume dark (the default theme) — corrected on hydration.
function getServerSnapshot(): boolean {
  return true;
}

export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      /* storage blocked — theme still applies for this page */
    }
  }, []);

  return (
    <button
      onClick={toggle}
      className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl text-fg-muted hover:text-fg hover:bg-surface-2 transition-all duration-200 cursor-pointer"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="relative block w-[18px] h-[18px]">
        <Sun
          className={`absolute inset-0 w-[18px] h-[18px] transition-all duration-300 ${
            dark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'
          }`}
        />
        <Moon
          className={`absolute inset-0 w-[18px] h-[18px] transition-all duration-300 ${
            dark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'
          }`}
        />
      </span>
    </button>
  );
}
