'use client';

import { useRef, type ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Read by screen readers as the dialog's description. */
  description?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Right-aligned buttons, [Cancel] first and the primary action last. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
};

const WIDTHS = { sm: 'max-w-[400px]', md: 'max-w-[520px]', lg: 'max-w-[720px]' } as const;

/**
 * Modal dialog. Radix traps focus, closes on Esc and backdrop click, locks
 * page scroll and returns focus to whatever opened it. Opening focus goes to
 * the first field, else the first button (the close button is last in DOM
 * order for that reason). Landscape phones get a full-screen sheet.
 */
export default function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  footer,
  children,
  className = '',
}: DialogProps) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-fade fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 short:p-0">
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
            // No description: say so explicitly, or Radix warns about a missing one.
            {...(description ? {} : { 'aria-describedby': undefined })}
            className={`ui-dialog relative flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-xl border border-edge bg-surface text-fg shadow-[var(--shadow-float)] short:h-dvh short:max-h-dvh short:max-w-none short:rounded-none ${WIDTHS[size]} ${className}`}
          >
            <div className="flex flex-col gap-1 px-5 pt-5 pr-14">
              <DialogPrimitive.Title className="text-[15px] leading-[22px] font-semibold">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-sm text-fg-muted">{description}</DialogPrimitive.Description>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">{children}</div>
            {footer && (
              <div className="flex flex-col-reverse gap-2 border-t border-edge px-5 py-3 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
                {footer}
              </div>
            )}
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute top-3 right-3 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors duration-[var(--dur-1)] pointer-coarse:size-11 pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg active:bg-surface-3"
            >
              <X aria-hidden="true" strokeWidth={1.75} className="size-4" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
