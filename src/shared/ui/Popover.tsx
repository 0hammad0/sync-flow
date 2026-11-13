'use client';

import type { ReactElement, ReactNode } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

type PopoverProps = {
  /** A focusable element (usually a button). It gets aria-expanded/controls. */
  trigger: ReactElement;
  children: ReactNode;
  /** Controlled mode. Leave both unset for uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Names the panel for screen readers when it has no heading. */
  'aria-label'?: string;
  className?: string;
};

/** Floating panel: filter editors, column menu, tap-for-detail on touch. Esc closes, focus returns. */
export default function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  'aria-label': ariaLabel,
  className = '',
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          align={align}
          sideOffset={4}
          collisionPadding={16}
          aria-label={ariaLabel}
          className={`ui-pop z-50 max-w-[var(--radix-popover-content-available-width)] rounded-lg border border-edge bg-surface p-3 text-sm text-fg shadow-[var(--shadow-float)] ${className}`}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
