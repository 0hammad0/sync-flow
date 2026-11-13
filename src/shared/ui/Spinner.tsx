import { LoaderCircle } from 'lucide-react';

type SpinnerProps = {
  size?: 12 | 16 | 20;
  /** Announces itself (role="status"). Leave unset inside a button that has aria-busy. */
  label?: string;
  className?: string;
};

const SIZES = { 12: 'size-3', 16: 'size-4', 20: 'size-5' } as const;

/** Small inline busy marker for buttons, switches and inline spots. Never for a whole page or panel. */
export default function Spinner({ size = 16, label, className = '' }: SpinnerProps) {
  const icon = (
    <LoaderCircle aria-hidden="true" strokeWidth={2} className={`animate-spin ${SIZES[size]} ${label ? '' : className}`} />
  );
  if (!label) return icon;
  return (
    <span role="status" className={`inline-flex ${className}`}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
