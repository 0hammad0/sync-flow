'use client';

import DataTable from '@/shared/ui/data-table/DataTable';
import { createAdminColumnHelper } from '@/shared/ui/data-table/types';
import type { CronRunDto } from '../cron-status';
import { formatDuration, formatUtc } from '../format';
import CronStatusBadge from './CronStatusBadge';

const col = createAdminColumnHelper<CronRunDto>();

// Module constant: the table needs a stable column array.
const COLUMNS = col.columns([
  col.accessor('startedAt', {
    id: 'started_at',
    header: 'Started',
    cell: (info) => <time dateTime={info.getValue()}>{formatUtc(info.getValue())}</time>,
    meta: { priority: 1, kind: 'time', card: 'title' },
  }),
  col.accessor('status', {
    header: 'Status',
    cell: (info) => <CronStatusBadge status={info.getValue()} />,
    meta: { priority: 1, kind: 'badge', card: 'trailing', width: 96 },
  }),
  col.accessor('filesDeleted', {
    header: 'Files',
    meta: { priority: 1, kind: 'number', label: 'Files deleted', card: 'subtitle', width: 72 },
  }),
  col.accessor('roomsDeleted', {
    header: 'Rooms',
    meta: { priority: 2, kind: 'number', label: 'Rooms deleted', width: 72 },
  }),
  col.accessor('sessionsDeleted', {
    header: 'Sessions',
    meta: { priority: 3, kind: 'number', label: 'Receive sessions deleted', width: 88 },
  }),
  col.accessor('durationMs', {
    header: 'Took',
    cell: (info) => formatDuration(info.getValue()),
    meta: { priority: 2, kind: 'number', label: 'Duration', width: 72 },
  }),
  col.accessor('errorId', {
    header: 'Error id',
    meta: { priority: 3, kind: 'id', width: 120 },
  }),
]);

// Not sortable: the list is the last runs, newest first, from one query.
const SORT = { allowed: ['started_at'], default: '-started_at' } as const;
const NO_PAGES = { prevCursor: null, nextCursor: null };

/** Last cleanup runs. Counts only: no tokens, keys or file names are stored [D-4]. */
export default function CronRunsTable({ runs }: { runs: CronRunDto[] }) {
  return (
    <DataTable<CronRunDto>
      label="Cleanup runs"
      columns={COLUMNS}
      rows={runs}
      getRowId={(run) => run.id}
      rowLabel={(run) => `run of ${formatUtc(run.startedAt)}`}
      sort={SORT}
      page={NO_PAGES}
      empty={{ title: 'No run recorded yet', body: 'The cleanup cron runs daily at 03:00 UTC.' }}
    />
  );
}
