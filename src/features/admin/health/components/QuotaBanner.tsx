import { CircleX, TriangleAlert } from 'lucide-react';
import type { QuotaBanner as QuotaBannerData } from '../tracking-status';

const LOOK = {
  warning: { box: 'border-warning/30 bg-warning/10 text-warning-text', icon: TriangleAlert },
  danger: { box: 'border-danger/30 bg-danger/10 text-danger-text', icon: CircleX },
} as const;

/**
 * Amber (≥ 70 %) or red (≥ 100 %) Firestore budget notice. `bar` is the thin
 * strip at the top of every admin page; `box` sits above the Health meters.
 */
export default function QuotaBanner({ banner, variant = 'box' }: { banner: QuotaBannerData; variant?: 'box' | 'bar' }) {
  const look = LOOK[banner.tone];
  const Icon = look.icon;
  const shape = variant === 'bar' ? 'border-b px-4 py-1.5 text-xs md:px-6' : 'rounded-md border p-3 text-sm';
  return (
    <p role="status" className={`flex items-start gap-2 ${shape} ${look.box}`}>
      <Icon aria-hidden="true" strokeWidth={1.75} className={`shrink-0 ${variant === 'bar' ? 'mt-px size-3.5' : 'mt-0.5 size-4'}`} />
      <span>{banner.text}</span>
    </p>
  );
}
