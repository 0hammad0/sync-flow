'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type InputProps = Omit<ComponentProps<'input'>, 'size'> & {
  /** Always rendered for screen readers; `hideLabel` only hides it visually. */
  label: string;
  hideLabel?: boolean;
  hint?: string;
  /** Replaces the hint and marks the field invalid. */
  error?: string;
  leading?: LucideIcon;
  /** e.g. a clear button, placed inside the right edge. */
  trailing?: ReactNode;
  size?: 'sm' | 'md';
};

const HEIGHTS = {
  sm: 'h-7 pointer-coarse:h-11',
  md: 'h-8 pointer-coarse:h-11',
} as const;

export default function Input({
  label,
  hideLabel = false,
  hint,
  error,
  leading: Leading,
  trailing,
  size = 'md',
  id,
  className = '',
  'aria-describedby': describedBy,
  ...rest
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const note = error ?? hint;
  const noteId = `${inputId}-note`;
  const describedByIds = [note ? noteId : null, describedBy].filter(Boolean).join(' ');

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'text-sm font-medium text-fg'}>
        {label}
      </label>
      <div className="relative">
        {Leading && (
          <Leading
            aria-hidden="true"
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-muted"
          />
        )}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds || undefined}
          className={[
            'input-admin w-full px-2.5 text-base pointer-fine:sm:text-sm',
            HEIGHTS[size],
            Leading ? 'pl-8' : '',
            trailing ? 'pr-10' : '',
          ].join(' ')}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {note && (
        <p id={noteId} className={`text-xs ${error ? 'text-danger-text' : 'text-fg-muted'}`}>
          {note}
        </p>
      )}
    </div>
  );
}
