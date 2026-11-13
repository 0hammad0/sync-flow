'use client';

import type { ReactNode } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';

type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  items: { value: string; label: string; count?: number; content: ReactNode }[];
  /** Names the tab list for screen readers. */
  label: string;
  className?: string;
};

/**
 * In-page tabs (same URL, panels swap). Only the active panel is mounted.
 * ←→ move and activate, Home/End jump. For tabs that change the URL, use a
 * <nav> of links with aria-current="page" instead.
 */
export default function Tabs({ value, onValueChange, items, label, className = '' }: TabsProps) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={className}>
      <TabsPrimitive.List
        aria-label={label}
        className="no-scrollbar flex gap-4 overflow-x-auto border-b border-edge"
      >
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className="relative inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 text-sm whitespace-nowrap text-fg-muted transition-colors duration-[var(--dur-1)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full pointer-coarse:h-11 pointer-fine:hover:text-fg focus-visible:-outline-offset-2! data-[state=active]:text-fg data-[state=active]:after:bg-brand"
          >
            {item.label}
            {item.count !== undefined && (
              <span className="text-xs text-fg-faint tabular-nums">{item.count.toLocaleString('en-US')}</span>
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Content key={item.value} value={item.value} className="pt-4">
          {item.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
