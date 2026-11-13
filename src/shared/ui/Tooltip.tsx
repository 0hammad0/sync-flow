'use client';

import type { ReactElement, ReactNode } from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

type TooltipProps = {
  /** Labels and exact values only. Never actions, links or the only copy of key info. */
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** A focusable element: the tooltip opens on hover and on keyboard focus. */
  children: ReactElement;
};

/**
 * Mount once around the admin shell. Shares the open delay, so moving from
 * one tooltip to the next within 300 ms opens it at once.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/**
 * Hover/focus label. Needs a `TooltipProvider` above it. Radix tooltips do
 * not open on tap, so data that touch users need goes in a Popover instead.
 */
export default function Tooltip({ content, side = 'top', children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="ui-tip z-50 max-w-[280px] rounded-md bg-fg px-2 py-1 text-xs text-canvas"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
