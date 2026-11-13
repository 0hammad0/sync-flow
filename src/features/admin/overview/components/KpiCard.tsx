import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import Badge from '@/shared/ui/Badge';
import Skeleton from '@/shared/ui/Skeleton';
import Tooltip from '@/shared/ui/Tooltip';
import type { KpiCardModel, KpiChange } from '../kpis';

// Overview KPI cards (02-overview.md "KPI card"): the whole card links to the
// screen with the detail; the tooltip has the exact number and the previous
// period. 128 px tall in every state, so loading causes no layout shift.

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5';
const CARD = 'flex h-32 min-w-0 flex-col justify-between rounded-lg border border-edge bg-surface p-3 sm:p-4';

function KpiDelta({ change }: { change: KpiChange | null }) {
  if (!change) return <span className="text-xs text-fg-faint">—</span>;
  const tone = change.good === null ? 'text-fg-muted' : change.good ? 'text-success-text' : 'text-danger-text';
  const Icon = change.sign > 0 ? ArrowUpRight : change.sign < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs tabular-nums ${tone}`}>
      <Icon aria-hidden="true" strokeWidth={2} className="size-3.5" />
      {change.text}
    </span>
  );
}

export default function KpiCard({ card }: { card: KpiCardModel }) {
  return (
    <Tooltip content={card.hint ? `${card.tooltip} ${card.hint}` : card.tooltip}>
      <Link
        href={card.href}
        aria-label={card.ariaLabel}
        className={`${CARD} transition-colors duration-[var(--dur-1)] pointer-fine:hover:bg-surface-2`}
      >
        <span className="truncate text-[13px] text-fg-muted">{card.label}</span>
        <span className="text-xl leading-tight font-semibold text-fg tabular-nums sm:text-2xl">{card.value}</span>
        <KpiDelta change={card.change} />
      </Link>
    </Tooltip>
  );
}

type KpiRowProps = {
  cards: KpiCardModel[];
  /** Some day in range had sampling on (counts ×2). */
  sampled: boolean;
  /** Past days rebuilt from hourly docs: the nightly rollup has not run for them yet. */
  incomplete: boolean;
};

export function KpiRow({ cards, sampled, incomplete }: KpiRowProps) {
  return (
    <section aria-labelledby="kpi-title" className="flex flex-col gap-2">
      <h2 id="kpi-title" className="sr-only">
        Key numbers
      </h2>
      <ul className={GRID}>
        {cards.map((card) => (
          <li key={card.key} className="min-w-0">
            <KpiCard card={card} />
          </li>
        ))}
      </ul>
      {(sampled || incomplete) && (
        <div className="flex flex-col gap-1 text-xs text-fg-muted">
          {sampled && (
            <p className="flex flex-wrap items-center gap-1.5">
              <Badge tone="warning">Sampled</Badge>
              Some sessions were skipped to stay in the free Firestore budget; counts were scaled ×2.
            </p>
          )}
          {incomplete && <p>Yesterday may be incomplete until the nightly rollup runs.</p>}
        </div>
      )}
    </section>
  );
}

const SKELETON_KEYS = ['visitors', 'sessions', 'pageviews', 'time', 'bounce'];

export function KpiRowSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading key numbers</span>
      <ul className={GRID}>
        {SKELETON_KEYS.map((key) => (
          <li key={key} className={CARD}>
            <Skeleton className="h-3.5 w-[120px] max-w-full" />
            <Skeleton className="h-7 w-24 max-w-full" shape="block" />
            <Skeleton className="h-3 w-16" />
          </li>
        ))}
      </ul>
    </div>
  );
}
