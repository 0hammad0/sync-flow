'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const THEME_KEY = 'sf-theme';

/**
 * Dark mode toggle. The initial class is set before paint by the inline
 * script in layout.tsx, so this component only needs to read the current
 * state from <html> and flip it.
 */
export default function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    setDark(next);
    try {
      window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      /* storage blocked — theme still applies for this page */
    }
  };

  // Render a stable placeholder until mounted to avoid hydration mismatch.
  if (dark === null) {
    return <div className="h-9 w-9 sm:h-10 sm:w-10" aria-hidden="true" />;
  }

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
