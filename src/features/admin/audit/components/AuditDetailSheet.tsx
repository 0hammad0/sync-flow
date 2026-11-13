'use client';

import type { ReactNode } from 'react';
import Sheet from '@/shared/ui/Sheet';
import { AUDIT_ACTION_LABELS } from '../catalog';
import { formatAuditTime } from '../format';
import type { AuditRowDto } from '../types';
import AuditDiff from './AuditDiff';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

/** Read-only detail of one entry. There is no edit or delete control anywhere. */
export default function AuditDetailSheet({ entry, onClose }: { entry: AuditRowDto | null; onClose: () => void }) {
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      side="right"
      width="min(480px, 100vw)"
      title={entry ? `${entry.action} · ${formatAuditTime(entry.at, true)}` : 'Audit entry'}
    >
      {!entry ? (
        <p className="text-sm text-fg-muted">Entry not found. It may be on another page or outside the date range.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <dl>
            <Row label="Action">{AUDIT_ACTION_LABELS[entry.action]}</Row>
            <Row label="Actor">
              {entry.actorEmail ?? (entry.actorUid ? <span className="font-mono text-xs">{entry.actorUid}</span> : 'Script')}
              {entry.actorRole && <span className="text-fg-muted"> ({entry.actorRole})</span>}
            </Row>
            {entry.ip && (
              <Row label="IP">
                <span className="font-mono text-xs">{entry.ip}</span>
              </Row>
            )}
            {entry.userAgent && (
              <Row label="Browser">
                <span className="text-xs">{entry.userAgent}</span>
              </Row>
            )}
            <Row label="Target">
              {entry.targetType || entry.targetId ? (
                <>
                  {entry.targetType && <span className="text-fg-muted">{entry.targetType} </span>}
                  <span className="font-mono text-xs break-all">{entry.targetId ?? '—'}</span>
                </>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Reason">{entry.reason ?? '—'}</Row>
            <Row label="Entry id">
              <span className="font-mono text-xs">{entry.id}</span>
            </Row>
          </dl>
          <section aria-labelledby="audit-changes">
            <h3 id="audit-changes" className="mb-2 text-sm font-semibold">
              Changes
            </h3>
            <AuditDiff before={entry.before} after={entry.after} />
          </section>
        </div>
      )}
    </Sheet>
  );
}
