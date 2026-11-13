// One source for every admin button look (05-components.md, Button).
// Each variant sets its own background, text and border. Callers add
// layout classes only (margin, width, display). Never colours: two
// utilities for the same property clash, and the winner depends on CSS
// chunk order, not on class order (the cause of the unreadable
// "New block" button).

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'link';
export type ButtonSize = 'sm' | 'md';

const BASE =
  'relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-[var(--dur-1,120ms)] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  // Text is white in light and ink in dark (--on-brand), both AA on --brand.
  primary: 'border border-transparent bg-brand text-on-brand pointer-fine:hover:bg-brand-hover',
  secondary: 'border border-edge-strong bg-surface text-fg pointer-fine:hover:bg-surface-2 active:bg-surface-3',
  ghost: 'border border-transparent text-fg-muted pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg active:bg-surface-3',
  danger: 'border border-danger/30 bg-danger/10 text-danger-text pointer-fine:hover:bg-danger/15',
  'danger-solid': 'border border-transparent bg-danger text-on-danger pointer-fine:hover:brightness-95',
  link: 'text-brand-text underline-offset-2 pointer-fine:hover:underline',
};

// 28 / 32 px with a fine pointer, 40 px on touch.
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-[13px] pointer-coarse:h-10',
  md: 'h-8 gap-2 rounded-md px-3 text-sm pointer-coarse:h-10',
};

// A link has no box: text size and icon gap only.
const LINK_SIZES: Record<ButtonSize, string> = { sm: 'gap-1 text-[13px]', md: 'gap-1.5 text-sm' };

export type ButtonStyleOptions = { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string };

/** Classes for a button look. Use it where `<Button>` cannot render the element (Radix triggers, `<a>`). */
export function buttonClass({ variant = 'secondary', size = 'md', fullWidth = false, className = '' }: ButtonStyleOptions = {}): string {
  const sizing = variant === 'link' ? LINK_SIZES[size] : SIZES[size];
  return `${BASE} ${VARIANTS[variant]} ${sizing}${fullWidth ? ' w-full' : ''}${className ? ` ${className}` : ''}`;
}

/** Square ghost icon button: 32 px, 40 px on touch. */
export function iconButtonClass(className = ''): string {
  return `inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors duration-[var(--dur-1,120ms)] pointer-coarse:size-10 pointer-fine:hover:bg-surface-2 pointer-fine:hover:text-fg active:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-surface-2 data-[state=open]:text-fg${className ? ` ${className}` : ''}`;
}
