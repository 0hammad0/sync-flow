'use client';

import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check, Minus } from 'lucide-react';

type CheckboxProps = {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
} & (
  | { label: string; 'aria-label'?: never }
  | { label?: never; 'aria-label': string } // e.g. a row checkbox in a table cell
);

/**
 * 16 px box. The hit area grows to 32 px (44 px on touch) with an invisible
 * ::after, so a bare checkbox in a table cell is still easy to hit.
 */
export default function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  name,
  id,
  className = '',
  label,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const box = (
    <CheckboxPrimitive.Root
      id={id}
      name={name}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      className="peer relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-edge-strong bg-surface text-on-brand transition-colors duration-[var(--dur-1)] after:absolute after:-inset-2 pointer-coarse:after:-inset-3.5 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand"
    >
      <CheckboxPrimitive.Indicator className="inline-flex">
        {checked === 'indeterminate' ? (
          <Minus aria-hidden="true" strokeWidth={2.5} className="size-3" />
        ) : (
          <Check aria-hidden="true" strokeWidth={2.5} className="size-3" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label) return <span className={`inline-flex ${className}`}>{box}</span>;

  return (
    <label
      className={`inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-fg select-none pointer-coarse:min-h-11 has-disabled:cursor-not-allowed ${className}`}
    >
      {box}
      <span className="peer-disabled:opacity-50">{label}</span>
    </label>
  );
}
