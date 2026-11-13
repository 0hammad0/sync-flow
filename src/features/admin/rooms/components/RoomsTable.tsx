'use client';

import { useMemo, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import NoDataYet from '@/shared/ui/illustrations/NoDataYet';
import Select from '@/shared/ui/Select';
import Tooltip from '@/shared/ui/Tooltip';
import DataTable from '@/shared/ui/data-table/DataTable';
import { createAdminColumnHelper, type AdminColumnDef } from '@/shared/ui/data-table/types';
import { expiryTone, formatBytes, formatCountdown, formatNumber, formatTtl, formatUtc } from '@/features/admin/format';
import type { CloseRoomData } from '../actions';
import { ROOM_STATUSES, ROOM_TTLS, type RoomStatusParam } from '../constants';
import type { RoomDetailDto, RoomRowDto } from '../types';
import RoomStatusFilter from './RoomStatusFilter';

// The sheet (and its close dialog) load only when `?code=` is set
// (12-rooms.md "Performance": sheet and close dialog via next/dynamic).
const RoomDetailSheet = dynamic(() => import('./RoomDetailSheet'));

/** sonner loads lazily (LazyToaster), so import it on use. */
async function toast(kind: 'success' | 'error', title: string, description?: string) {
  const { toast: t } = await import('sonner');
  t[kind](title, description ? { description } : undefined);
}

const SORT = { allowed: [] as string[], default: 'default' };
const ALL_TTLS = 'all';

type RoomsTableProps = {
  rows: RoomRowDto[];
  status: Exclude<RoomStatusParam, 'history'>;
  ttl: string | null;
  page: { prevCursor: string | null; nextCursor: string | null };
  /** `?code=` was set: the sheet is open on this code. `detail` null = room gone. */
  sheet: { code: string; detail: RoomDetailDto | null } | null;
  nowMs: number;
  canClose: boolean;
  canSeeUsers: boolean;
  adminEmail: string | null;
  error?: { reason: string; errorId?: string };
};

/** Live rooms, metadata only [D-4] (12-rooms.md). Row → detail sheet (`?code=`). */
export default function RoomsTable({ rows, status, ttl, page, sheet, nowMs, canClose, canSeeUsers, adminEmail, error }: RoomsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [, setParams] = useQueryStates(
    {
      status: parseAsStringLiteral(ROOM_STATUSES).withDefault('live'),
      ttl: parseAsStringLiteral(ROOM_TTLS),
      cursor: parseAsString,
      code: parseAsString,
    },
    { shallow: false, history: 'push', startTransition },
  );

  const columns = useMemo(() => buildColumns(nowMs), [nowMs]);

  const rowHref = (row: RoomRowDto) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('code', row.code);
    return `${pathname}?${params.toString()}`;
  };

  const onClosed = (data: CloseRoomData) => {
    void toast('success', `Room ${data.code} closed`, `${formatNumber(data.fileCount)} files (${formatBytes(data.totalBytes)}) deleted.`);
    void setParams({ code: null });
    router.refresh();
  };

  const onGone = () => {
    void toast('error', 'This room was already closed or expired.');
    void setParams({ code: null });
    router.refresh();
  };

  return (
    <>
      <DataTable<RoomRowDto>
        label="Rooms"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.code}
        rowLabel={(row) => `room ${row.code}`}
        rowHref={rowHref}
        sort={SORT}
        page={page}
        status={error ? 'error' : 'ready'}
        error={error ? { title: 'Could not load rooms.', reason: error.reason, errorId: error.errorId, onRetry: () => router.refresh() } : undefined}
        empty={{
          title: status === 'expiring' ? 'No rooms expire within the hour.' : 'No live rooms.',
          body: 'Rooms appear here while they are open. They delete themselves when they expire.',
          illustration: <NoDataYet />,
        }}
        noResults={{ title: 'No room with that code.', body: 'Codes are 8 letters and numbers.' }}
        search={{ placeholder: 'Search code…' }}
        filters={
          <>
            <RoomStatusFilter
              value={status}
              onChange={(next) => void setParams({ status: next === 'live' ? null : next, cursor: null, code: null })}
            />
            <Select
              label="TTL"
              hideLabel
              size="sm"
              value={ttl ?? ALL_TTLS}
              onValueChange={(next) => void setParams({ ttl: next === ALL_TTLS ? null : (next as (typeof ROOM_TTLS)[number]), cursor: null })}
              options={[{ value: ALL_TTLS, label: 'All TTLs' }, ...ROOM_TTLS.map((t) => ({ value: t, label: formatTtl(Number(t)) }))]}
            />
          </>
        }
        activeFilters={(status !== 'live' ? 1 : 0) + (ttl ? 1 : 0)}
        onClearFilters={() => void setParams({ status: null, ttl: null, cursor: null })}
      />
      {sheet && (
        <RoomDetailSheet
          code={sheet.code}
          detail={sheet.detail}
          nowMs={nowMs}
          canClose={canClose}
          canSeeUsers={canSeeUsers}
          adminEmail={adminEmail}
          onOpenChange={(open) => {
            if (!open) void setParams({ code: null });
          }}
          onClosed={onClosed}
          onGone={onGone}
        />
      )}
    </>
  );
}

const col = createAdminColumnHelper<RoomRowDto>();

function buildColumns(nowMs: number): AdminColumnDef<RoomRowDto>[] {
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
    col.accessor('ttlHours', {
      header: 'TTL',
      cell: (info) => formatTtl(info.getValue()),
      meta: { priority: 3, kind: 'number', align: 'right', width: 64, card: 'hidden' },
    }),
    col.accessor('expiresAt', {
      id: 'expires',
      header: 'Expires',
      cell: (info) => {
        const value = info.getValue();
        const tone = expiryTone(value, nowMs);
        return (
          <Tooltip content={formatUtc(value)}>
            <span
              className={`tabular-nums ${tone === 'expired' ? 'text-danger-text' : tone === 'soon' ? 'text-warning-text' : ''}`}
            >
              {formatCountdown(value, nowMs)}
            </span>
          </Tooltip>
        );
      },
      meta: { priority: 1, kind: 'time', width: 112, card: 'trailing' },
    }),
    col.accessor('onlineCount', {
      id: 'online',
      header: 'Online',
      cell: (info) => {
        const n = info.getValue();
        if (n == null) return '—';
        return n > 0 ? (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
            {n}
            <span className="sr-only"> online</span>
          </span>
        ) : (
          <span className="text-fg-muted tabular-nums">0</span>
        );
      },
      meta: { priority: 1, kind: 'number', align: 'right', width: 72, card: 'meta' },
    }),
    col.accessor('messageCount', {
      id: 'messages',
      header: 'Messages',
      cell: (info) => <span className="tabular-nums">{formatNumber(info.getValue())}</span>,
      meta: { priority: 2, kind: 'number', align: 'right', width: 88, card: 'meta' },
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
      cell: (info) => {
        const bytes = info.getValue();
        return bytes == null ? (
          <Tooltip content="Could not read size.">
            <span>—</span>
          </Tooltip>
        ) : (
          <Tooltip content={`${formatNumber(bytes)} bytes`}>
            <span className="tabular-nums">{formatBytes(bytes)}</span>
          </Tooltip>
        );
      },
      meta: { priority: 2, kind: 'number', align: 'right', width: 88, card: 'meta' },
    }),
  ]);
}
