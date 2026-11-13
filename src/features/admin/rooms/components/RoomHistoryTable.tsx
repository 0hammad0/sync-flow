'use client';

import { useMemo, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import Tooltip from '@/shared/ui/Tooltip';
import DataTable from '@/shared/ui/data-table/DataTable';
import { createAdminColumnHelper, type AdminColumnDef } from '@/shared/ui/data-table/types';
import { formatBytes, formatNumber, formatTtl, formatUtc } from '@/features/admin/format';
import { ROOM_STATUSES } from '../schemas';
import type { RoomHistoryRowDto } from '../types';
import RoomStatusFilter from './RoomStatusFilter';

const SORT = { allowed: [] as string[], default: 'default' };

type RoomHistoryTableProps = {
  rows: RoomHistoryRowDto[];
  page: { prevCursor: string | null; nextCursor: string | null };
  canSeeUsers: boolean;
  error?: { reason: string; errorId?: string };
};

/** History tab: closed rooms from `a_rooms`, newest close first, 25 per page. Counts only [D-4]. */
export default function RoomHistoryTable({ rows, page, canSeeUsers, error }: RoomHistoryTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [, setParams] = useQueryStates(
    { status: parseAsStringLiteral(ROOM_STATUSES).withDefault('live'), cursor: parseAsString },
    { shallow: false, history: 'push', startTransition },
  );
  const columns = useMemo(() => buildColumns(canSeeUsers), [canSeeUsers]);

  return (
    <DataTable<RoomHistoryRowDto>
      label="Closed rooms"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.code}
      rowLabel={(row) => `room ${row.code}`}
      sort={SORT}
      page={page}
      status={error ? 'error' : 'ready'}
      error={
        error ? { title: 'Could not load room history.', reason: error.reason, errorId: error.errorId, onRetry: () => router.refresh() } : undefined
      }
      empty={{
        title: 'No closed rooms yet.',
        body: 'Rooms show here after they expire or an admin closes them. Kept for 365 days.',
      }}
      filters={
        <RoomStatusFilter
          value="history"
          onChange={(next) => void setParams({ status: next === 'live' ? null : next, cursor: null })}
        />
      }
      activeFilters={1}
      onClearFilters={() => void setParams({ status: null, cursor: null })}
    />
  );
}

const col = createAdminColumnHelper<RoomHistoryRowDto>();

function buildColumns(canSeeUsers: boolean): AdminColumnDef<RoomHistoryRowDto>[] {
  return col.columns([
    col.accessor('code', {
      header: 'Code',
      cell: (info) => <span className="font-mono text-[13px]">{info.getValue()}</span>,
      meta: { priority: 1, kind: 'id', width: 104, card: 'title' },
    }),
    col.accessor('name', {
      header: 'Name',
      cell: (info) => (
        <span dir="auto" className="truncate">
          {info.getValue() ?? '—'}
        </span>
      ),
      meta: { priority: 2, card: 'subtitle' },
    }),
    col.accessor('closedAt', {
      id: 'closed',
      header: 'Closed',
      cell: (info) => <span className="tabular-nums">{formatUtc(info.getValue())}</span>,
      meta: { priority: 1, kind: 'time', width: 184, card: 'trailing' },
    }),
    col.accessor('closedBy', {
      header: 'How',
      cell: (info) => {
        const by = info.getValue();
        if (by === 'cron') return 'Expired';
        return canSeeUsers ? (
          <Link className="text-brand-text hover:underline" href={`/admin/users/${by}`}>
            Closed by admin
          </Link>
        ) : (
          'Closed by admin'
        );
      },
      meta: { priority: 2, width: 128, card: 'meta' },
    }),
    col.accessor('ttlHours', {
      header: 'TTL',
      cell: (info) => formatTtl(info.getValue()),
      meta: { priority: 3, kind: 'number', align: 'right', width: 64, card: 'hidden' },
    }),
    col.accessor('messageCount', {
      id: 'messages',
      header: 'Messages',
      cell: (info) => <span className="tabular-nums">{formatNumber(info.getValue())}</span>,
      meta: { priority: 1, kind: 'number', align: 'right', width: 88, card: 'meta' },
    }),
    col.accessor('fileCount', {
      id: 'files',
      header: 'Files',
      cell: (info) => <span className="tabular-nums">{formatNumber(info.getValue())}</span>,
      meta: { priority: 3, kind: 'number', align: 'right', width: 64, card: 'hidden' },
    }),
    col.accessor('totalBytes', {
      id: 'size',
      header: 'Size',
      cell: (info) => <span className="tabular-nums">{formatBytes(info.getValue())}</span>,
      meta: { priority: 2, kind: 'number', align: 'right', width: 88, card: 'meta' },
    }),
    col.accessor('peakOnline', {
      id: 'peak',
      header: 'Peak online',
      cell: (info) => (
        <Tooltip content="Highest count seen by an admin or when the room closed. Not a true peak.">
          <span className="tabular-nums">{formatNumber(info.getValue())}</span>
        </Tooltip>
      ),
      meta: { priority: 3, kind: 'number', align: 'right', width: 104, card: 'hidden' },
    }),
  ]);
}
