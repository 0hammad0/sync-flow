/**
 * Short line sample that names a series without relying on colour:
 * solid `--chart-1` for this period, dashed `--fg-faint` for the compare period.
 */
export function SeriesKey({ kind }: { kind: 'series' | 'compare' }) {
  const compare = kind === 'compare';
  return (
    <svg aria-hidden="true" width="16" height="6" viewBox="0 0 16 6" className="shrink-0">
      <line
        x1="0"
        y1="3"
        x2="16"
        y2="3"
        stroke={compare ? 'var(--fg-faint)' : 'var(--chart-1)'}
        strokeWidth={compare ? 1.5 : 2}
        strokeDasharray={compare ? '4 3' : undefined}
      />
    </svg>
  );
}
