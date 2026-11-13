import type { ButtonHTMLAttributes, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { iconButtonClass } from './button-styles';

export type IconButtonProps = {
  icon: LucideIcon;
  /** Required: the button has no visible text. */
  'aria-label': string;
  /** Layout only (margin, display, visibility). Never colours. */
  className?: string;
  ref?: Ref<HTMLButtonElement>;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children' | 'aria-label'>;

/** Square ghost button with one icon: 32 px, 40 px on touch. Works as a Radix `asChild` trigger. */
export default function IconButton({ icon: Icon, className = '', type = 'button', ref, ...rest }: IconButtonProps) {
  return (
    <button ref={ref} type={type} className={iconButtonClass(className)} {...rest}>
      <Icon aria-hidden="true" strokeWidth={1.75} className="size-4" />
    </button>
  );
}
