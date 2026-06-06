'use client';

import Link from 'next/link';
import LoadingSpinner from '../LoadingSpinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingText?: string;
  href?: string;
  fullWidth?: boolean;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  // The flagship gradient button — brand violet → cyan with a glow on hover
  primary:
    'bg-flow text-white shadow-md hover:shadow-[var(--glow)] hover:brightness-110',
  secondary:
    'bg-surface text-fg border border-edge-strong hover:bg-surface-2 hover:border-edge-strong',
  ghost:
    'text-fg-muted hover:text-fg hover:bg-surface-2',
  danger:
    'bg-danger/10 text-danger-text hover:bg-danger/20',
  dark:
    'bg-fg text-canvas hover:opacity-90',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs sm:text-sm rounded-lg gap-1.5',
  md: 'px-4 py-2.5 text-sm rounded-xl gap-2',
  lg: 'px-6 py-3 text-sm sm:text-base rounded-xl gap-2',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  href,
  fullWidth = false,
  className = '',
  disabled = false,
  type = 'button',
  title,
  onClick,
  children,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const classes = [
    'inline-flex items-center justify-center font-medium select-none',
    'transition-all duration-200 cursor-pointer btn-hover',
    VARIANTS[variant],
    SIZES[size],
    fullWidth ? 'w-full' : '',
    isDisabled ? 'opacity-50 pointer-events-none cursor-not-allowed' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = loading ? (
    <>
      <LoadingSpinner size="sm" className="text-current" />
      {loadingText && <span>{loadingText}</span>}
    </>
  ) : (
    children
  );

  if (href && !isDisabled) {
    return (
      <Link href={href} className={classes} title={title}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={classes}
      title={title}
    >
      {content}
    </button>
  );
}
