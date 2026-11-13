'use client';

import { useId } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { LoaderCircle } from 'lucide-react';

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  /** An optimistic save is in flight: toggling is paused, focus stays. */
  pending?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
};

/** For settings that apply at once. Never inside a form with a Save button. */
export default function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  pending = false,
  disabled,
  id,
  className = '',
}: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const descriptionId = `${switchId}-description`;

  return (
    <div className={`flex min-h-8 items-center justify-between gap-4 pointer-coarse:min-h-11 ${className}`}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={switchId} className="cursor-pointer text-sm text-fg">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-xs text-fg-muted">
            {description}
          </p>
        )}
      </div>
      <SwitchPrimitive.Root
        id={switchId}
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        onCheckedChange={(v) => {
          if (!pending) onCheckedChange(v);
        }}
        className="relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full bg-surface-3 inset-ring inset-ring-edge-strong transition-colors duration-[var(--dur-1)] after:absolute after:-inset-2 pointer-coarse:after:-inset-3.5 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-wait data-[state=checked]:bg-brand data-[state=checked]:inset-ring-transparent"
      >
        <SwitchPrimitive.Thumb className="pointer-events-none flex size-3.5 translate-x-0.5 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-[var(--dur-1)] ease-[var(--ease-enter)] data-[state=checked]:translate-x-4">
          {pending && <LoaderCircle aria-hidden="true" strokeWidth={2.5} className="size-2.5 animate-spin text-fg-muted" />}
        </SwitchPrimitive.Thumb>
      </SwitchPrimitive.Root>
    </div>
  );
}
