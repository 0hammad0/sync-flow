'use client';

import { useRef, type ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'left' | 'right' | 'bottom';
  title: string;
  hideTitle?: boolean;
  description?: string;
  /** left/right only. Default: left `var(--admin-sheet-w)`, right 420 px (full width < 640). */
  width?: string;
  children?: ReactNode;
  className?: string;
};

// Each side pads the safe-area insets on its open edges.
const SIDES = {
  left: 'inset-y-0 left-0 w-[var(--admin-sheet-w)] border-r pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]',
  right:
    'inset-y-0 right-0 w-full border-l pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] sm:w-[420px]',
  bottom:
    'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t pb-[env(safe-area-inset-bottom)] short:max-h-dvh',
} as const;

/** Drawer on a screen edge: mobile nav (left), detail (right), phone actions (bottom). */
export default function Sheet({
  open,
  onOpenChange,
  side,
  title,
  hideTitle = false,
  description,
  width,
  children,
  className = '',
}: SheetProps) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-fade fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          onOpenAutoFocus={() => {
            returnFocusRef.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            // Radix returns focus only to a Radix Trigger. These dialogs are
            // controlled, so return it to whatever had focus when they opened.
            const target = returnFocusRef.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          data-side={side}
          style={width && side !== 'bottom' ? { width } : undefined}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={`ui-sheet fixed z-50 flex flex-col border-edge bg-surface text-fg shadow-[var(--shadow-float)] ${SIDES[side]} ${className}`}
        >
          {side === 'bottom' && (
            <div aria-hidden="true" className="mx-auto mt-2 h-1 w-8 shrink-0 rounded-full bg-edge-strong" />
          )}
          <div className={hideTitle ? 'sr-only' : 'flex flex-col gap-1 px-4 pt-4 pr-14'}>
            <DialogPrimitive.Title className="text-[15px] leading-[22px] font-semibold">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-sm text-fg-muted">{description}</DialogPrimitive.Description>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">{children}</div>
          <DialogPrimitive.Close
            aria-label="Close"
            className={`absolute ${side === 'bottom' ? 'top-4' : 'top-[calc(env(safe-area-inset-top)+0.75rem)]'} right-3 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors duration-[var(--dur-1)] pointer-coarse:size-11 pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg active:bg-surface-3`}
          >
            <X aria-hidden="true" strokeWidth={1.75} className="size-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
