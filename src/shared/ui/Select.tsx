'use client';

import { useId } from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';

type SelectProps<T extends string> = {
  label: string;
  hideLabel?: boolean;
  value: T | '';
  onValueChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  placeholder?: string;
  error?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
};

const HEIGHTS = {
  sm: 'h-7 pointer-coarse:h-11',
  md: 'h-8 pointer-coarse:h-11',
} as const;

export default function Select<T extends string>({
  label,
  hideLabel = false,
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  error,
  size = 'md',
  disabled,
  name,
  id,
  className = '',
}: SelectProps<T>) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const errorId = `${triggerId}-error`;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={triggerId} className={hideLabel ? 'sr-only' : 'text-sm font-medium text-fg'}>
        {label}
      </label>
      <SelectPrimitive.Root
        value={value}
        onValueChange={(v) => onValueChange(v as T)}
        disabled={disabled}
        name={name}
      >
        <SelectPrimitive.Trigger
          id={triggerId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`input-admin flex w-full cursor-pointer items-center justify-between gap-2 px-2.5 text-left text-base pointer-fine:sm:text-sm data-[placeholder]:text-fg-faint ${HEIGHTS[size]}`}
        >
          <span className="truncate">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
          <SelectPrimitive.Icon asChild>
            <ChevronDown aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-fg-muted" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            collisionPadding={16}
            className="ui-pop z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-edge bg-surface shadow-[var(--shadow-float)]"
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="relative flex h-8 cursor-pointer items-center rounded-md pr-2 pl-7 text-sm text-fg select-none pointer-coarse:h-11 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 focus-visible:-outline-offset-2!"
                >
                  <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
                    <Check aria-hidden="true" strokeWidth={1.75} className="size-4 text-brand-text" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {error && (
        <p id={errorId} className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
