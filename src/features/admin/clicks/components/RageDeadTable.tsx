import Link from 'next/link';
import { formatNumber, formatUtc } from '@/features/admin/format';
import type { RageDeadRowDto } from '../types';

// Rage / dead list (06-clicks.md "Rage list", "Dead list"): grouped by path +
// target, most frequent first. Each row links to the session with the latest
// event. Server-rendered, no client JS.

const COPY = {
  rage: { caption: 'Rage clicks', count: 'Rage clicks' },
  dead: { caption: 'Dead clicks', count: 'Dead clicks' },
} as const;

export default function RageDeadTable({ rows, kind }: { rows: readonly RageDeadRowDto[]; kind: 'rage' | 'dead' }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-edge bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{COPY[kind].caption}</caption>
        <thead>
          <tr className="border-b border-edge text-left text-xs text-fg-muted">
            <th scope="col" className="px-3 py-2 font-medium">
              Element
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
              Page
            </th>
            <th scope="col" className="w-24 px-3 py-2 text-right font-medium">
              {COPY[kind].count}
            </th>
            <th scope="col" className="hidden w-24 px-3 py-2 text-right font-medium min-[480px]:table-cell">
              Sessions
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
              Last
            </th>
            <th scope="col" className="w-28 px-3 py-2 font-medium">
              <span className="sr-only">Session</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.path} ${row.target}`} className="border-b border-edge last:border-b-0">
              <th scope="row" className="max-w-0 px-3 py-2 text-left font-normal">
                <span className="block truncate text-fg">
                  {row.label ? <span>“{row.label}” </span> : null}
                  <span className="font-mono text-xs text-fg-faint" title={row.target}>
                    {row.target}
                  </span>
                </span>
                <span className="block truncate font-mono text-xs text-fg-muted sm:hidden">{row.path}</span>
              </th>
              <td className="hidden px-3 py-2 font-mono text-xs text-fg-muted sm:table-cell">{row.path}</td>
              <td className="px-3 py-2 text-right tabular-nums text-fg">{formatNumber(row.count)}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums text-fg-muted min-[480px]:table-cell">
                {formatNumber(row.sessions)}
              </td>
              <td className="hidden px-3 py-2 text-xs whitespace-nowrap text-fg-muted md:table-cell">{formatUtc(row.lastAt)}</td>
              <td className="px-3 py-2 text-right">
                {row.lastSessionId ? (
                  <Link
                    href={`/admin/sessions/${row.lastSessionId}`}
                    className="text-xs whitespace-nowrap text-brand-text underline-offset-2 hover:underline"
                  >
                    See session
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
