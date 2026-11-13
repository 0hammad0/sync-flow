import Link from 'next/link';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import { buttonClass, type ButtonSize, type ButtonVariant } from './button-styles';

export type AdminButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: LucideIcon;
  /** Trailing icon, e.g. a chevron or an X. */
  iconRight?: LucideIcon;
  /** Spinner inside. Clicks are ignored; focus stays (aria-disabled, not disabled). */
  loading?: boolean;
  /** Shown next to the spinner. Without it the label keeps its space, so the width never changes. */
  loadingText?: string;
  /** Renders a Next.js link with the same look. */
  href?: string;
  fullWidth?: boolean;
  /** Layout only (margin, width, display). Never colours. */
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

/**
 * The admin button. Every variant is readable in light and dark: the colour
 * pairs come from tokens checked for contrast (05-components.md).
 * Server-safe: no hooks, so it renders in Server and Client Components.
 */
export default function AdminButton({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  loadingText,
  href,
  fullWidth = false,
  className = '',
  type = 'button',
  onClick,
  children,
  ...rest
}: AdminButtonProps) {
  const classes = buttonClass({ variant, size, fullWidth, className });
  const iconSize = size === 'sm' ? 'size-3.5' : 'size-4';
  const label = (
    <>
      {Icon && <Icon aria-hidden="true" strokeWidth={1.75} className={iconSize} />}
      {children}
      {IconRight && <IconRight aria-hidden="true" strokeWidth={1.75} className={iconSize} />}
    </>
  );

  if (href && !loading && !rest.disabled) {
    return (
      <Link href={href} className={classes}>
        {label}
      </Link>
    );
  }

  const spinner = <LoaderCircle aria-hidden="true" strokeWidth={2} className={`${iconSize} animate-spin`} />;
  const content = !loading ? (
    label
  ) : loadingText ? (
    <>
      {spinner}
      {loadingText}
    </>
  ) : (
    <>
      <span className="invisible inline-flex items-center gap-[inherit]">{label}</span>
      <span className="absolute inset-0 flex items-center justify-center">{spinner}</span>
    </>
  );

  return (
    <button
      type={type}
      className={classes}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      // No wrapper when idle, so a Server Component can render it without a handler.
      onClick={loading ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault() : onClick}
      {...rest}
    >
      {content}
    </button>
  );
}
