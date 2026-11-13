'use client';

import { useTransition, type ReactNode } from 'react';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { Tabs as TabsPrimitive } from 'radix-ui';
import Select from '@/shared/ui/Select';
import { SOURCE_TAB_LABELS, SOURCE_TABS, type SourceTab } from '../constants';

const TRIGGER =
  'relative inline-flex h-9 shrink-0 cursor-pointer items-center text-sm whitespace-nowrap text-fg-muted transition-colors duration-[var(--dur-1)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full pointer-coarse:h-11 pointer-fine:hover:text-fg focus-visible:-outline-offset-2! data-[state=active]:text-fg data-[state=active]:after:bg-brand';

/**
 * Referrers / UTM / Devices / Browsers / OS, kept in `?tab=` (08-sources.md).
 * Radix tabs from 640 px (arrow keys move between them), a Select on phones.
 * A new tab keeps the range and drops the sort, page and any open drill.
 */
export default function SourcesTabs({ children }: { children: ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(
    {
      tab: parseAsStringLiteral(SOURCE_TABS),
      sort: parseAsString,
      cursor: parseAsString,
      host: parseAsString,
      browser: parseAsString,
    },
    { shallow: false, history: 'push', startTransition },
  );
  // nuqs updates its state at once; the server render follows in the transition.
  const value: SourceTab = params.tab ?? 'referrers';

  const change = (next: string) => {
    if (!(SOURCE_TABS as readonly string[]).includes(next)) return;
    void setParams({ tab: next === 'referrers' ? null : (next as SourceTab), sort: null, cursor: null, host: null, browser: null });
  };

  return (
    <TabsPrimitive.Root value={value} onValueChange={change}>
      <div className="mb-3 sm:hidden">
        <Select
          label="Show"
          hideLabel
          value={value}
          onValueChange={change}
          options={SOURCE_TABS.map((t) => ({ value: t, label: SOURCE_TAB_LABELS[t] }))}
        />
      </div>
      <TabsPrimitive.List
        aria-label="Sources"
        className="no-scrollbar mb-4 hidden gap-4 overflow-x-auto border-b border-edge sm:flex"
      >
        {SOURCE_TABS.map((t) => (
          <TabsPrimitive.Trigger key={t} value={t} className={TRIGGER}>
            {SOURCE_TAB_LABELS[t]}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      <TabsPrimitive.Content value={value} forceMount className={pending ? 'opacity-60 transition-opacity' : undefined}>
        {children}
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  );
}
