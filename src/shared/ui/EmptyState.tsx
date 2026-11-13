import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export type StateSize = 'page' | 'panel' | 'inline';

export interface EmptyStateProps {
  /** e.g. `<NoResults />`, imported by the caller so it ships only where used. Ignored when size is `inline`. */
  illustration?: ReactNode;
  /** Shown in a 32 px circle when size is `inline` (the picture is dropped there). Default: `Inbox`. */
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  /** Primary action, e.g. a `<Button>` or a link. Only pass it when the user can act. */
  action?: ReactNode;
  secondaryAction?: ReactNode;
  size?: StateSize;
  /** Heading element for the title. Default: h2 (page), h3 (panel), p (inline). */
  titleAs?: 'h1' | 'h2' | 'h3' | 'p';
  /** Extra content under the body, e.g. an error id. */
  children?: ReactNode;
  /** `alert` only when the view replaces content after a user action (ErrorState). */
  role?: 'alert' | 'status';
  /** Spacing only. Never colours. */
  className?: string;
}

const LAYOUT: Record<StateSize, string> = {
  page: 'min-h-80 max-w-[420px] flex-col justify-center py-8',
  panel: 'h-full flex-col justify-center py-6',
  inline: 'min-h-[calc(var(--admin-row-h,2.5rem)*5)] items-center gap-3 py-4',
};

const TITLE: Record<StateSize, string> = {
  page: 'text-[15px] leading-[22px]',
  panel: 'text-sm',
  inline: 'text-sm',
};

const DEFAULT_TITLE_TAG = { page: 'h2', panel: 'h3', inline: 'p' } as const;

/**
 * Empty (and, through ErrorState, error) view. Left-aligned, never centred (principle 4).
 * Copy lives in docs 06-states.md section 6; rules in 11-copy.md.
 */
export default function EmptyState({
  illustration,
  icon,
  title,
  body,
  action,
  secondaryAction,
  size = 'panel',
  titleAs,
  children,
  role,
  className = '',
}: EmptyStateProps) {
  const Title = titleAs ?? DEFAULT_TITLE_TAG[size];
  const inline = size === 'inline';
  const actions =
    action || secondaryAction ? (
      <div className={`flex flex-wrap items-center gap-2 ${inline ? '' : 'mt-4'}`}>
        {action}
        {secondaryAction}
      </div>
    ) : null;

  return (
    <div role={role} className={`flex text-left ${LAYOUT[size]} ${className}`}>
      {inline ? (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted *:size-5"
        >
          {icon ?? <Inbox />}
        </span>
      ) : (
        illustration && (
          <div className={`mb-4 *:h-auto *:w-full ${size === 'page' ? 'w-40' : 'w-30'}`}>
            {illustration}
          </div>
        )
      )}
      <div className={inline ? 'min-w-0 flex-1' : ''}>
        <Title className={`font-semibold text-fg ${TITLE[size]}`}>{title}</Title>
        {body && <p className="mt-1 text-sm text-fg-muted">{body}</p>}
        {children}
        {!inline && actions}
      </div>
      {inline && actions}
    </div>
  );
}
