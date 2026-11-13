'use client';

// Client only for the "Copy error id" button (clipboard + "Copied" state).
import type { ReactNode } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { useCopy } from '@/shared/lib/clipboard';
import EmptyState, { type StateSize } from './EmptyState';
import ErrorGeneric from './illustrations/ErrorGeneric';

export interface ErrorStateProps {
  /** "Couldn't load sessions". Not red: the title stays `text-fg`. */
  title: string;
  /** Cause in plain words, from the error kind (06-states.md 6.3). */
  reason: string;
  /** Server error id (e.g. `err_8k2f9a` or `error.digest`). Shows a "Copy error id" control. */
  errorId?: string;
  /** Usually `[Retry]` (secondary button). */
  action?: ReactNode;
  secondaryAction?: ReactNode;
  size?: StateSize;
  /** Default `<ErrorGeneric />`. Pass `null` for none. Not shown when size is `inline`. */
  illustration?: ReactNode;
  /** `role="alert"` only when this replaces content after a user action. Not on first render. */
  announce?: boolean;
  titleAs?: 'h1' | 'h2' | 'h3' | 'p';
  className?: string;
}

export default function ErrorState({
  title,
  reason,
  errorId,
  action,
  secondaryAction,
  size = 'panel',
  illustration = <ErrorGeneric />,
  announce = false,
  titleAs,
  className,
}: ErrorStateProps) {
  return (
    <EmptyState
      role={announce ? 'alert' : undefined}
      size={size}
      title={title}
      body={reason}
      illustration={illustration}
      icon={<AlertTriangle className="text-danger-text" />}
      action={action}
      secondaryAction={secondaryAction}
      titleAs={titleAs}
      className={className}
    >
      {errorId && <ErrorId id={errorId} />}
    </EmptyState>
  );
}

function ErrorId({ id }: { id: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <code className="font-mono text-xs text-fg-faint">{id}</code>
      <button
        type="button"
        onClick={() => copy(id)}
        className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-fg-muted transition-colors duration-[var(--dur-1,120ms)] hover:bg-surface-2 hover:text-fg pointer-coarse:h-10 pointer-coarse:px-2.5"
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {copied ? 'Copied' : 'Copy error id'}
      </button>
      <span role="status" className="sr-only">
        {copied ? 'Error id copied' : ''}
      </span>
    </div>
  );
}
