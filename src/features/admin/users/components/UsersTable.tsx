'use client';

import { useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import Badge from '@/shared/ui/Badge';
import SegmentedControl from '@/shared/ui/SegmentedControl';
import Tooltip from '@/shared/ui/Tooltip';
import DataTable from '@/shared/ui/data-table/DataTable';
import { createAdminColumnHelper, type AdminColumnDef } from '@/shared/ui/data-table/types';
import { formatAgo, formatBytes, formatDay, formatNumber, formatUtc } from '@/features/admin/format';
import { USER_FILTERS, type UserFilter } from '../constants';
import type { UserRowDto } from '../types';
import RoleBadge from './RoleBadge';

const SORT = { allowed: [] as string[], default: 'default' };
const FILTER_LABELS: Record<UserFilter, string> = { all: 'All', admins: 'Admins', disabled: 'Disabled' };

type UsersTableProps = {
  rows: UserRowDto[];
  filter: UserFilter;
  nextCursor: string | null;
  selfUid: string;
  nowMs: number;
  error?: { reason: string; errorId?: string };
};

/** Firebase Auth users (13-users.md). Forward paging with Auth page tokens. Row → /admin/users/[uid]. */
export default function UsersTable({ rows, filter, nextCursor, selfUid, nowMs, error }: UsersTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [, setParams] = useQueryStates(
    { filter: parseAsStringLiteral(USER_FILTERS).withDefault('all'), cursor: parseAsString },
    { shallow: false, history: 'push', startTransition },
  );
  const columns = useMemo(() => buildColumns(selfUid, nowMs), [selfUid, nowMs]);

  return (
    <DataTable<UserRowDto>
      label="Users"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.uid}
      rowLabel={(row) => row.email ?? row.uid}
      rowHref={(row) => `/admin/users/${row.uid}`}
      sort={SORT}
      page={{ prevCursor: null, nextCursor }}
      pagination="load-more"
      status={error ? 'error' : 'ready'}
      error={error ? { title: 'Could not load users.', reason: error.reason, errorId: error.errorId, onRetry: () => router.refresh() } : undefined}
      empty={{ title: 'No signed-in users yet.', body: 'People appear here after their first email-link sign-in.' }}
      noResults={
        filter === 'disabled'
          ? { title: 'No disabled users on this page.', body: 'The filter checks the loaded users only. Load more to check the next ones.' }
          : { title: 'No user with that email or uid.', body: 'Search needs the full email.' }
      }
      search={{ placeholder: 'Email or uid…' }}
      filters={
        <SegmentedControl
          label="Users filter"
          size="sm"
          value={filter}
          onValueChange={(next) => void setParams({ filter: next === 'all' ? null : next, cursor: null })}
          items={USER_FILTERS.map((f) => ({ value: f, label: FILTER_LABELS[f] }))}
        />
      }
      activeFilters={filter !== 'all' ? 1 : 0}
      onClearFilters={() => void setParams({ filter: null, cursor: null })}
    />
  );
}

const col = createAdminColumnHelper<UserRowDto>();

function buildColumns(selfUid: string, nowMs: number): AdminColumnDef<UserRowDto>[] {
  return col.columns([
    col.accessor('email', {
      header: 'Email',
      cell: (info) => {
        const row = info.row.original;
        return (
          <span className={`flex min-w-0 items-center gap-2 ${row.disabled ? 'text-fg-muted' : ''}`}>
            <span className="truncate">{row.email ?? row.uid}</span>
            {row.disabled && <Badge tone="danger">Disabled</Badge>}
            {row.uid === selfUid && <span className="shrink-0 text-xs text-fg-muted">This is you.</span>}
          </span>
        );
      },
      meta: { priority: 1, card: 'title' },
    }),
    col.accessor('role', {
      header: 'Role',
      cell: (info) => <RoleBadge role={info.getValue()} />,
      meta: { priority: 1, kind: 'badge', width: 104, card: 'subtitle' },
    }),
    col.accessor('createdAt', {
      id: 'joined',
      header: 'Joined',
      cell: (info) => <span className="tabular-nums">{formatDay(info.getValue())}</span>,
      meta: { priority: 3, kind: 'time', width: 112, card: 'hidden' },
    }),
    col.accessor('lastSeenAt', {
      id: 'lastSeen',
      header: 'Last seen',
      cell: (info) => (
        <Tooltip content={`Last token refresh: ${formatUtc(info.getValue())}`}>
          <span className="tabular-nums">{formatAgo(info.getValue(), nowMs)}</span>
        </Tooltip>
      ),
      meta: { priority: 2, kind: 'time', width: 104, card: 'trailing' },
    }),
    col.accessor('fileCount', {
      id: 'files',
      header: 'Files',
      cell: (info) => <span className="tabular-nums">{formatNumber(info.getValue())}</span>,
      meta: { priority: 2, kind: 'number', align: 'right', width: 64, card: 'meta' },
    }),
    col.accessor('fileBytes', {
      id: 'storage',
      header: 'Storage',
      cell: (info) => <span className="tabular-nums">{formatBytes(info.getValue())}</span>,
      meta: { priority: 3, kind: 'number', align: 'right', width: 88, card: 'meta' },
    }),
  ]);
}
