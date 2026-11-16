import { formatNumber } from '@/features/admin/format';
import { VW_LABELS } from '../constants';
import type { ClickTargetDto, VwBucket } from '../types';

// Element ranking (06-clicks.md "Element list"): clicks grouped by target,
// with rage % and dead %. The accessible source of truth for the map. No
// hooks, so it renders on the server for the list view (first paint, no
// client JS) and inside the lazy map, where hover / pin highlight dots.

type ElementRankingProps = {
  rows: readonly ClickTargetDto[];
  path: string;
  vw: VwBucket;
  /** Map view: the highlighted row and the hover / pin handlers. */
  active?: number | null;
  onHover?: (index: number | null) => void;
  onPin?: (index: number) => void;
  compact?: boolean;
};

function pct(value: number): string {
  if (value <= 0) return '0%';
  if (value < 0.01) return '<1%';
  return `${Math.round(value * 100)}%`;
}

export default function ElementRanking({ rows, path, vw, active = null, onHover, onPin, compact = false }: ElementRankingProps) {
  const interactive = !!onPin;
  const caption = `Clicks on ${path} at ${VW_LABELS[vw].label.toLowerCase()} width`;
  return (
    <div className="overflow-x-auto rounded-lg border border-edge bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-edge text-left text-xs text-fg-muted">
            <th scope="col" className="px-3 py-2 font-medium">
              Element
            </th>
            <th scope="col" className="w-20 px-3 py-2 text-right font-medium">
              Clicks
            </th>
            {!compact && (
              <th scope="col" className="hidden w-24 px-3 py-2 text-right font-medium sm:table-cell">
                Of views
              </th>
            )}
            <th scope="col" className="w-20 px-3 py-2 text-right font-medium">
              Rage
            </th>
            <th scope="col" className={`w-20 px-3 py-2 text-right font-medium ${compact ? '' : 'hidden min-[400px]:table-cell'}`}>
              Dead
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const selected = active === i;
            return (
              <tr
                key={row.target}
                data-selected={selected || undefined}
                onMouseEnter={onHover ? () => onHover(i) : undefined}
                onMouseLeave={onHover ? () => onHover(null) : undefined}
                className="border-b border-edge last:border-b-0 data-[selected]:bg-brand/10"
              >
                <th scope="row" className="max-w-0 px-3 py-2 text-left font-normal">
                  {interactive ? (
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onPin?.(i)}
                      onFocus={onHover ? () => onHover(i) : undefined}
                      className="block w-full cursor-pointer truncate rounded-sm text-left text-fg"
                    >
                      <TargetText row={row} />
                    </button>
                  ) : (
                    <span className="block truncate text-fg">
                      <TargetText row={row} />
                    </span>
                  )}
                </th>
                <td className="px-3 py-2 text-right tabular-nums text-fg">{formatNumber(row.clicks)}</td>
                {!compact && (
                  <td className="hidden px-3 py-2 text-right tabular-nums text-fg-muted sm:table-cell">{pct(row.shareOfViews)}</td>
                )}
                <td className={`px-3 py-2 text-right tabular-nums ${row.rage > 0 ? 'text-warning-text' : 'text-fg-muted'}`}>
                  {pct(row.ragePct)}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums text-fg-muted ${compact ? '' : 'hidden min-[400px]:table-cell'}`}>
                  {pct(row.deadPct)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TargetText({ row }: { row: ClickTargetDto }) {
  return (
    <>
      {row.label ? <span>“{row.label}”</span> : null}
      <span className={`font-mono text-xs text-fg-faint ${row.label ? 'ml-2' : ''}`} title={row.target}>
        {row.target}
      </span>
    </>
  );
}
