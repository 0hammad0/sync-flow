'use client';

import { useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from 'nuqs';
import { AlertTriangle, X } from 'lucide-react';
import Badge from '@/shared/ui/Badge';
import Select from '@/shared/ui/Select';
import Tooltip from '@/shared/ui/Tooltip';
import DataTable from '@/shared/ui/data-table/DataTable';
import AdminButton from '@/shared/ui/AdminButton';
import { createAdminColumnHelper, type AdminColumnDef } from '@/shared/ui/data-table/types';
import { AUDIT_ACTION_LABELS, AUDIT_ACTION_LIST, isDangerAction, type AuditActionName } from '../catalog';
import { formatAuditTime, middleTruncate } from '../format';
import { AUDIT_RANGES, AUDIT_RANGE_LABELS, type AuditRange } from '../ranges';
import type { AuditRowDto } from '../types';
import AuditDetailSheet from './AuditDetailSheet';

const ALL = 'all';
const SORT = { allowed: [] as string[], default: 'default' };

type AuditTableProps = {
  rows: AuditRowDto[];
  range: AuditRange;
  action: AuditActionName | null;
  /** The actor filter as applied (moderators: never shown, it is forced). */
  actor: { uid: string; label: string } | null;
  page: { prevCursor: string | null; nextCursor: string | null };
  /** Owners only: exact target-id search. Moderators have no index for it. */
  canSearch: boolean;
  /** Owners only: click an actor to filter by them. */
  canFilterActor: boolean;
  error?: { title: string; reason: string; errorId?: string };
};

/** The audit log table. Read only: no row actions, no selection, no edit or delete. */
export default function AuditTable({ rows, range, action, actor, page, canSearch, canFilterActor, error }: AuditTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // One filter at a time (one index each): picking one clears the other.
  const [, setFilters] = useQueryStates(
    {
      range: parseAsStringLiteral(AUDIT_RANGES).withDefault('30d'),
      action: parseAsStringLiteral(AUDIT_ACTION_LIST),
      actor: parseAsString,
      cursor: parseAsString,
    },
    { shallow: false, history: 'push', startTransition },
  );
  // The detail sheet reads rows already on the page: no extra Firestore read.
  const [openId, setOpenId] = useQueryState('id', parseAsString.withOptions({ shallow: true, history: 'push' }));
  const open = openId ? (rows.find((r) => r.id === openId) ?? null) : undefined;

  const columns = useMemo(
    () =>
      buildColumns({
        openRow: (id) => void setOpenId(id),
        filterActor: canFilterActor
          ? (uid) => void setFilters({ actor: uid, action: null, cursor: null })
          : null,
        filterAction: (a) => void setFilters({ action: a, ...(canFilterActor ? { actor: null } : {}), cursor: null }),
      }),
    [canFilterActor, setFilters, setOpenId],
  );

  const filters = (
    <>
      <Select
        label="Action"
        hideLabel
        size="sm"
        value={action ?? ALL}
        onValueChange={(next) =>
          void setFilters({ action: next === ALL ? null : (next as AuditActionName), ...(canFilterActor ? { actor: null } : {}), cursor: null })
        }
        options={[{ value: ALL, label: 'All actions' }, ...AUDIT_ACTION_LIST.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] }))]}
      />
      <Select
        label="Date range"
        hideLabel
        size="sm"
        value={range}
        onValueChange={(next) => void setFilters({ range: next === '30d' ? null : next, cursor: null })}
        options={AUDIT_RANGES.map((r) => ({ value: r, label: AUDIT_RANGE_LABELS[r] }))}
      />
      {actor && (
        <AdminButton size="sm" iconRight={X} onClick={() => void setFilters({ actor: null, cursor: null })}>
          Actor: {actor.label}
          <span className="sr-only">Remove actor filter</span>
        </AdminButton>
      )}
    </>
  );

  return (
    <>
      <DataTable<AuditRowDto>
        label="Admin actions, newest first"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        rowLabel={(row) => `${row.action} ${formatAuditTime(row.at)}`}
        sort={SORT}
        page={page}
        status={error ? 'error' : 'ready'}
        error={error ? { ...error, onRetry: () => router.refresh() } : undefined}
        empty={{ title: 'No admin actions yet.', body: 'Every block, delete and sign-in will appear here.' }}
        noResults={{ title: 'No entries match these filters.' }}
        search={canSearch ? { placeholder: 'Exact target id…' } : undefined}
        filters={filters}
        activeFilters={(action ? 1 : 0) + (actor ? 1 : 0) + (range !== '30d' ? 1 : 0)}
        onClearFilters={() => void setFilters({ action: null, actor: null, range: null, cursor: null })}
      />
      {open !== undefined && <AuditDetailSheet entry={open} onClose={() => void setOpenId(null)} />}
    </>
  );
}

const col = createAdminColumnHelper<AuditRowDto>();

type ColumnHandlers = {
  openRow: (id: string) => void;
  filterActor: ((uid: string) => void) | null;
  filterAction: (action: AuditActionName) => void;
};

function actorLabel(row: AuditRowDto): string {
  if (row.actorEmail) return row.actorEmail;
  return row.actorUid ? middleTruncate(row.actorUid, 14) : 'Script';
}

function buildColumns({ openRow, filterActor, filterAction }: ColumnHandlers): AdminColumnDef<AuditRowDto>[] {
  return col.columns([
    col.accessor('at', {
      header: 'When',
      cell: (info) => (
        <Tooltip content={formatAuditTime(info.getValue(), true)}>
          <button
            type="button"
            className="cursor-pointer tabular-nums underline-offset-2 pointer-fine:hover:underline"
            onClick={() => openRow(info.row.original.id)}
          >
            {formatAuditTime(info.getValue())}
            <span className="sr-only">, open details</span>
          </button>
        </Tooltip>
      ),
      meta: { priority: 1, kind: 'time', width: 120, card: 'trailing' },
    }),
    col.accessor((row) => actorLabel(row), {
      id: 'actor',
      header: 'Actor',
      cell: (info) => {
        const row = info.row.original;
        const text = (
          <>
            <span className="truncate">{info.getValue()}</span>
            {row.actorRole && <span className="text-fg-muted"> · {row.actorRole}</span>}
          </>
        );
        return filterActor && row.actorUid ? (
          <button
            type="button"
            className="max-w-full cursor-pointer truncate text-left pointer-fine:hover:underline"
            onClick={() => filterActor(row.actorUid as string)}
            title="Show only this actor"
          >
            {text}
          </button>
        ) : (
          <span className="truncate">{text}</span>
        );
      },
      meta: { priority: 1, card: 'subtitle' },
    }),
    col.accessor('action', {
      header: 'Action',
      cell: (info) => {
        const action = info.row.original.action;
        const danger = isDangerAction(action);
        return (
          <button type="button" className="cursor-pointer" onClick={() => filterAction(action)} title={`Show only ${AUDIT_ACTION_LABELS[action]}`}>
            <Badge tone={danger ? 'danger' : 'neutral'} icon={danger ? AlertTriangle : undefined} className="font-mono">
              {action}
            </Badge>
          </button>
        );
      },
      meta: { priority: 1, width: 168, card: 'title' },
    }),
    col.accessor((row) => (row.targetId ? `${row.targetType ?? ''} ${row.targetId}`.trim() : null), {
      id: 'target',
      header: 'Target',
      cell: (info) => {
        const row = info.row.original;
        if (!row.targetId) return null;
        return (
          <Tooltip content={row.targetId}>
            <span className="truncate">
              {row.targetType && <span className="text-fg-muted">{row.targetType} </span>}
              <span className="font-mono text-[12.5px]">{middleTruncate(row.targetId)}</span>
            </span>
          </Tooltip>
        );
      },
      meta: { priority: 2, card: 'meta' },
    }),
    col.accessor('reason', {
      header: 'Reason',
      cell: (info) => <span className="line-clamp-1">{info.getValue()}</span>,
      meta: { priority: 3, card: 'meta' },
    }),
  ]);
}
