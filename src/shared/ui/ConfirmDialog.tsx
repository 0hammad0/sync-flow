'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { AlertDialog } from 'radix-ui';
import { buttonClass } from './button-styles';
import { LoaderCircle } from 'lucide-react';

/** What `onConfirm` resolves to. Matches the admin action result shape. */
export type ConfirmResult = { ok: true } | { ok: false; error: string; message?: string };

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Verb + object + "?", e.g. "Block 203.0.113.7?" */
  title: string;
  /** One line: what happens, and whether it can be undone. */
  consequence: string;
  /** The same verb as the title, e.g. "Block". */
  confirmLabel: string;
  tone?: 'default' | 'danger';
  /** Exact, case-sensitive text the user must type before confirming. */
  typeToConfirm?: string;
  onConfirm: () => Promise<ConfirmResult>;
  /** Optional extra fields, e.g. a reason input. */
  children?: ReactNode;
};

const CONFIRM_VARIANT = { default: 'primary', danger: 'danger-solid' } as const;

/**
 * Confirmation for an action with consequences. Does not close on backdrop
 * click. While the action runs, Esc, Cancel and Confirm do nothing; on
 * failure the dialog stays open with the reason under the consequence line.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  tone = 'default',
  typeToConfirm,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const inputId = useId();

  const matches = typeToConfirm === undefined || typed === typeToConfirm;
  const blocked = pending || !matches;

  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setTyped('');
      setError(null);
    }
    onOpenChange(next);
  };

  const confirm = async () => {
    if (blocked) return;
    setPending(true);
    setError(null);
    let result: ConfirmResult;
    try {
      result = await onConfirm();
    } catch {
      result = { ok: false, error: 'network' };
    }
    setPending(false);
    if (result.ok) {
      setTyped('');
      onOpenChange(false);
    } else {
      setError(result.message ?? `Couldn't ${confirmLabel.toLowerCase()}. Check your connection and try again.`);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="ui-fade fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
          <AlertDialog.Content
            onOpenAutoFocus={(event) => {
              returnFocusRef.current = document.activeElement as HTMLElement | null;
              // Danger: land on Cancel (Radix default). Otherwise the field or Confirm.
              if (typeToConfirm !== undefined) {
                event.preventDefault();
                inputRef.current?.focus();
              } else if (tone !== 'danger') {
                event.preventDefault();
                confirmRef.current?.focus();
              }
            }}
            onCloseAutoFocus={(event) => {
              // Radix returns focus only to a Radix Trigger; this dialog is controlled.
              const target = returnFocusRef.current;
              if (target?.isConnected) {
                event.preventDefault();
                target.focus();
              }
            }}
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
            className="ui-dialog flex w-full max-w-[400px] flex-col gap-4 rounded-xl border border-edge bg-surface p-5 text-fg shadow-[var(--shadow-float)]"
          >
            <div className="flex flex-col gap-1.5">
              <AlertDialog.Title className="text-[15px] leading-[22px] font-semibold">{title}</AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-fg-muted">{consequence}</AlertDialog.Description>
              {error && (
                <p role="alert" className="text-sm text-danger-text">
                  {error}
                </p>
              )}
            </div>

            {children}

            {typeToConfirm !== undefined && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={inputId} className="text-sm text-fg">
                  Type <strong className="font-mono font-semibold">{typeToConfirm}</strong> to confirm
                </label>
                <input
                  ref={inputRef}
                  id={inputId}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="input-admin h-8 w-full px-2.5 font-mono text-base pointer-coarse:h-11 pointer-fine:sm:text-sm"
                />
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel
                aria-disabled={pending || undefined}
                onClick={(e) => {
                  if (pending) e.preventDefault();
                }}
                className={buttonClass()}
              >
                Cancel
              </AlertDialog.Cancel>
              <button
                ref={confirmRef}
                type="button"
                onClick={confirm}
                aria-disabled={blocked || undefined}
                aria-busy={pending || undefined}
                className={buttonClass({ variant: CONFIRM_VARIANT[tone] })}
              >
                <span className={pending ? 'invisible' : undefined}>{confirmLabel}</span>
                {pending && (
                  <LoaderCircle aria-hidden="true" strokeWidth={2} className="absolute size-4 animate-spin" />
                )}
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
