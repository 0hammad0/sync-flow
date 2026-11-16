'use client';

import { useEffect } from 'react';
import type { SettingsSection } from '../constants';

const LINKS: { id: SettingsSection; label: string }[] = [
  { id: 'tracking', label: 'Tracking' },
  { id: 'retention', label: 'Retention' },
  { id: 'roles', label: 'Roles' },
  { id: 'danger', label: 'Danger zone' },
];

/**
 * Section jump links (15-settings.md "Layout"): a sticky column at ≥ 1024,
 * a scrollable row above the form below that. `?section=` scrolls to its
 * section once on load (deep links from the command palette).
 */
export default function SettingsNav({ initial }: { initial: SettingsSection | null }) {
  useEffect(() => {
    if (initial) document.getElementById(initial)?.scrollIntoView({ block: 'start' });
  }, [initial]);

  return (
    <nav aria-label="Settings sections" className="mb-6 lg:mb-0">
      <ul className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:overflow-visible">
        {LINKS.map((link) => (
          <li key={link.id} className="shrink-0">
            <a
              href={`?section=${link.id}#${link.id}`}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-sm text-fg-muted pointer-coarse:h-11 pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg lg:w-full"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
