import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type BadgeProps = {
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  /** Status badges need an icon or dot too: color is never the only signal. */
  icon?: LucideIcon;
  dot?: boolean;
  children: ReactNode;
  className?: string;
};

const TONES = {
  neutral: 'bg-surface-2 text-fg-muted',
  brand: 'bg-brand/10 text-brand-text',
  success: 'bg-success/10 text-success-text',
  warning: 'bg-warning/12 text-warning-text',
  danger: 'bg-danger/10 text-danger-text',
} as const;

/** Small non-interactive label. */
export default function Badge({ tone = 'neutral', icon: Icon, dot = false, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-xs leading-none font-medium whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {Icon && <Icon aria-hidden="true" strokeWidth={1.75} className="size-3" />}
      {dot && !Icon && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
