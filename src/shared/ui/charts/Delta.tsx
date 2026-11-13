import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { formatChange } from './format';

type DeltaProps = {
  value: number;
  previous: number;
  /** false for metrics where up is bad (bounce rate). Default true. */
  higherIsBetter?: boolean;
  className?: string;
};

/**
 * Change vs the previous value: arrow icon + signed percent ("↗ +12.4%").
 * Colour (success/danger) only adds to the sign and icon, never replaces them.
 * Renders "—" when there is no base to compare with.
 */
export default function Delta({ value, previous, higherIsBetter = true, className = '' }: DeltaProps) {
  const change = formatChange(value, previous);
  if (!change) return <span className={`text-fg-faint ${className}`}>—</span>;
  const good = change.sign !== 0 && change.sign > 0 === higherIsBetter;
  const tone = change.sign === 0 ? 'text-fg-muted' : good ? 'text-success-text' : 'text-danger-text';
  const Icon = change.sign > 0 ? ArrowUpRight : change.sign < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${tone} ${className}`}>
      <Icon aria-hidden="true" strokeWidth={2} className="size-3.5" />
      {change.text}
    </span>
  );
}
