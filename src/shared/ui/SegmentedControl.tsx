'use client';

import { RadioGroup } from 'radix-ui';
import type { LucideIcon } from 'lucide-react';

type SegmentedControlProps<T extends string> = {
  /** Names the group for screen readers (not shown). */
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  /** 2–4 items. */
  items: { value: T; label: string; icon?: LucideIcon }[];
  size?: 'sm' | 'md';
  className?: string;
};

const ITEM_HEIGHTS = {
  sm: 'h-6 pointer-coarse:h-11',
  md: 'h-7 pointer-coarse:h-11',
} as const;

/**
 * Small exclusive choice (density, chart metric). A radio group: Tab enters
 * once on the selected item, ←→ move and select, and it can never be empty.
 */
export default function SegmentedControl<T extends string>({
  label,
  value,
  onValueChange,
  items,
  size = 'md',
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      orientation="horizontal"
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      className={`inline-flex gap-0.5 rounded-md bg-surface-2 p-0.5 ${className}`}
    >
      {items.map(({ value: itemValue, label: itemLabel, icon: Icon }) => (
        <RadioGroup.Item
          key={itemValue}
          value={itemValue}
          className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[5px] border border-transparent px-2.5 text-sm text-fg-muted transition-colors duration-[var(--dur-1)] pointer-fine:hover:text-fg data-[state=checked]:border-edge data-[state=checked]:bg-surface data-[state=checked]:text-fg ${ITEM_HEIGHTS[size]}`}
        >
          {Icon && <Icon aria-hidden="true" strokeWidth={1.75} className="size-4" />}
          {itemLabel}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
