'use client';

import { useId, useState } from 'react';
import { diffAudit, type AuditData } from '../diff';

/**
 * Before / after as a table (11-audit-log.md "Diff"): unchanged fields are
 * hidden until "Show all fields". Text, not colour, says what changed.
 */
export default function AuditDiff({ before, after }: { before: AuditData; after: AuditData }) {
  const [showAll, setShowAll] = useState(false);
  const toggleId = useId();
  const rows = diffAudit(before, after);
  if (rows.length === 0) return <p className="text-sm text-fg-muted">No recorded changes.</p>;

  const shown = showAll ? rows : rows.filter((r) => r.changed);
  const hidden = rows.length - shown.length;

  return (
    <div className="flex flex-col gap-2">
      <table className="w-full table-fixed border-collapse text-[13px]">
        <caption className="sr-only">Changes, before and after</caption>
        <thead>
          <tr className="border-b border-edge text-left text-xs text-fg-muted">
            <th scope="col" className="w-1/4 py-1.5 pr-2 font-medium">
              Field
            </th>
            <th scope="col" className="py-1.5 pr-2 font-medium">
              Before
            </th>
            <th scope="col" className="py-1.5 font-medium">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.field} className="border-b border-edge align-top">
              <th scope="row" className="py-1.5 pr-2 text-left font-mono text-xs font-normal break-all text-fg-muted">
                {row.field}
              </th>
              <td className="py-1.5 pr-2 font-mono text-xs break-all">{row.before}</td>
              <td className="py-1.5 font-mono text-xs break-all">
                {row.after}
                {!row.changed && <span className="sr-only"> (unchanged)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="text-sm text-fg-muted">No field changed.</p>}
      {(hidden > 0 || showAll) && (
        <label htmlFor={toggleId} className="inline-flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
          <input id={toggleId} type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all fields{hidden > 0 ? ` (${hidden} unchanged)` : ''}
        </label>
      )}
    </div>
  );
}
