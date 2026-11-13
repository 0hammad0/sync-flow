export type MeterTone = 'brand' | 'warning' | 'danger';

const TONES: Record<MeterTone, string> = { brand: 'bg-brand', warning: 'bg-warning', danger: 'bg-danger' };

type UsageMeterProps = {
  /** Accessible name, e.g. "Firestore writes used today". */
  label: string;
  value: number;
  max: number;
  /** Read out instead of the raw number, e.g. "3,600 of 5,000". */
  valueText: string;
  tone: MeterTone;
  /** Layout only. Never colours. */
  className?: string;
};

/** Thin used-vs-limit bar (`role="meter"`). Colour is never the only signal: callers show the numbers too. */
export default function UsageMeter({ label, value, max, valueText, tone, className = '' }: UsageMeterProps) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={valueText}
      className={`h-2 w-full overflow-hidden rounded-full bg-surface-3 ${className}`}
    >
      <div className={`h-full rounded-full ${TONES[tone]}`} style={{ width: `${percent.toFixed(1)}%` }} />
    </div>
  );
}
