'use client';

import { useSyncExternalStore } from 'react';
// SunMedium/MoonStar, not the public toggle's Sun/Moon: sharing those icons
// made Turbopack split them into a chunk every public page loads (+39 B gz).
import { MoonStar, SunMedium } from 'lucide-react';
import { SIDEBAR_ROW } from './styles';

// Same theme system as the public site: the `.dark` class on <html> (set before
// paint by the root layout script) and the `sf-theme` localStorage key.
const THEME_KEY = 'sf-theme';

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
const getSnapshot = () => document.documentElement.classList.contains('dark');
const getServerSnapshot = () => false;

/** "Dark theme" on/off. The icon is picked by CSS (`dark:`), so it is right before hydration. */
export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      // Storage blocked: the theme still applies to this page.
    }
  };

  return (
    <button type="button" onClick={toggle} aria-pressed={dark} className={SIDEBAR_ROW}>
      <SunMedium aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 dark:hidden" />
      <MoonStar aria-hidden="true" strokeWidth={1.75} className="hidden size-4 shrink-0 dark:block" />
      <span className="admin-sb-label truncate">Dark theme</span>
    </button>
  );
}
