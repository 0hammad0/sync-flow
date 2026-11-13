'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { parseAsString, useQueryStates } from 'nuqs';
import { Ban } from 'lucide-react';
import type { SessionRowDto } from '@/server/analytics/dto';
import { countryName } from '@/shared/lib/block-values';
import Select from '@/shared/ui/Select';
import DataTable from '@/shared/ui/data-table/DataTable';
import type { RowAction } from '@/shared/ui/data-table/RowActions';
import { createAdminColumnHelper, type AdminColumnDef } from '@/shared/ui/data-table/types';
import BlockDialog from '@/features/admin/access/components/BlockDialog';
import { formatUtc } from '@/features/admin/access/format';
import type { AccessActorDto } from '@/features/admin/access/types';
import ExportButton from '@/features/admin/export/ExportButton';
import { blockTargetFor, formatDevice, formatPaths, formatPlace, formatSource } from '../format';
import { DEVICE_LABELS, SESSION_DEVICES, SESSIONS_BACK_KEY } from '../constants';
import type { SessionsFilter } from '../schemas';
import { DurationText, IpCell, PlaceCell, StartedCell, UserCell } from './SessionRowCard';

/** sonner loads lazily (LazyToaster), so import it on use. */
async function toast(title: string, description?: string) {
  const { toast: t } = await import('sonner');
  t.success(title, description ? { description } : undefined);
}

/** `started_at desc` is the only order (one index per filter). */
const SORT = { allowed: [] as string[], default: 'default' };
const ALL = 'all';

let countryOptions: { value: string; label: string }[] | null = null;
/** ISO alpha-2 codes the browser can name, by name. Built once, on first render. */
function countries() {
  if (countryOptions) return countryOptions;
  const list: { value: string; label: string }[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = countryName(code);
      if (name) list.push({ value: code, label: `${name} (${code})` });
    }
  }
  countryOptions = list.sort((x, y) => x.label.localeCompare(y.label));
  return countryOptions;
}

type BlockTarget = { type: 'ip' | 'cidr'; value: string };

export type SessionsTableProps = {
  rows: SessionRowDto[];
  /** `count()` of the filtered range; IP search: rows found. */
  total: number | null;
  page: { prevCursor: string | null; nextCursor: string | null };
  /** The one filter in use (after precedence), or null. */
  filter: SessionsFilter | null;
  /** UTC day `YYYY-MM-DD` the server rendered on, so "today" reads the same on both sides. */
  today: string;
  /** `ip:read`: search by IP. Rows arrive already masked without it. */
  canSeeIp: boolean;
  /** `blocks:write` (and a full IP on the row). */
  canBlock: boolean;
  canExport: boolean;
  canOpenUsers: boolean;
  /** Self-block checks in the block dialog. Only needed with `canBlock`. */
  actor: AccessActorDto | null;
  error?: { title: string; reason: string; errorId?: string };
};

/** Every visit in the range (04-sessions.md). Cursor pages of 25, newest first. Row → /admin/sessions/[id]. */
export default function SessionsTable({
  rows,
  total,
  page,
  filter,
  today,
  canSeeIp,
  canBlock,
  canExport,
  canOpenUsers,
  actor,
  error,
}: SessionsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null);
  // One filter at a time: picking one drops the others, the search and the page.
  const [, setParams] = useQueryStates(
    { q: parseAsString, country: parseAsString, device: parseAsString, cursor: parseAsString },
    { shallow: false, history: 'push', startTransition },
  );

  const search = searchParams?.toString() ?? '';
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSIONS_BACK_KEY, search ? `?${search}` : '');
    } catch {
      // Storage blocked: the back link goes to the plain list.
    }
  }, [search]);

  const columns = useMemo(() => buildColumns(today, canOpenUsers), [today, canOpenUsers]);

  const rowActions = (row: SessionRowDto): RowAction[] => {
    const target = canBlock && actor ? blockTargetFor(row) : null;
    if (!target) return [];
    return [
      {
        type: 'item',
        label: target.type === 'ip' ? 'Block this IP…' : 'Block this range…',
        icon: Ban,
        tone: 'danger',
        onSelect: () => setBlockTarget(target),
      },
    ];
  };

  const country = filter?.kind === 'country' ? filter.value : null;
  const device = filter?.kind === 'device' ? filter.value : null;

  const filters = (
    <>
      <Select
        label="Country"
        hideLabel
        size="sm"
        value={country ?? ALL}
        onValueChange={(next) =>
          void setParams({ country: next === ALL ? null : next, device: null, q: null, cursor: null })
        }
        options={[{ value: ALL, label: 'All countries' }, ...countries()]}
      />
      <Select
        label="Device"
        hideLabel
        size="sm"
        value={device ?? ALL}
        onValueChange={(next) =>
          void setParams({ device: next === ALL ? null : next, country: null, q: null, cursor: null })
        }
        options={[{ value: ALL, label: 'All devices' }, ...SESSION_DEVICES.map((d) => ({ value: d, label: DEVICE_LABELS[d] }))]}
      />
    </>
  );

  return (
    <>
      <DataTable<SessionRowDto>
        label="Sessions"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        rowLabel={(row) => `session ${row.id.slice(0, 8)}`}
        rowHref={(row) => `/admin/sessions/${row.id}`}
        sort={SORT}
        page={{ ...page, total }}
        status={error ? 'error' : 'ready'}
        error={error ? { ...error, onRetry: () => router.refresh() } : undefined}
        empty={{
          title: 'No sessions in this range.',
          body: 'Visits appear here a few seconds after they happen. Try a longer range.',
        }}
        noResults={{ title: 'No sessions match these filters.', body: 'Clear the filter or try a longer range.' }}
        search={{ placeholder: canSeeIp ? 'Full IP or user id…' : 'User id…' }}
        filters={filters}
        activeFilters={country || device ? 1 : 0}
        onClearFilters={() => void setParams({ country: null, device: null, cursor: null })}
        actions={<ExportButton table="sessions" canExport={canExport} />}
        rowActions={rowActions}
      />
      {blockTarget && actor && (
        <BlockDialog
          key={`${blockTarget.type}:${blockTarget.value}`}
          open
          onOpenChange={(open) => {
            if (!open) setBlockTarget(null);
          }}
          actor={actor}
          initial={blockTarget}
          onCreated={(row) => {
            void toast(`Blocked ${row.value}`, row.expiresAt ? `Ends ${formatUtc(row.expiresAt)}` : 'Never ends.');
          }}
        />
      )}
    </>
  );
}

const col = createAdminColumnHelper<SessionRowDto>();

/** Priorities: P1 always, P2 from a 640 px container, P3 from 960 px (tablet hides Pages and Device). */
function buildColumns(today: string, canOpenUsers: boolean): AdminColumnDef<SessionRowDto>[] {
  return col.columns([
    col.accessor('startedAt', {
      id: 'started',
      header: 'Started',
      cell: (info) => <StartedCell row={info.row.original} today={today} />,
      meta: { priority: 1, kind: 'time', card: 'title' },
    }),
    col.accessor('durationMs', {
      id: 'duration',
      header: 'Duration',
      cell: (info) => <DurationText ms={info.getValue()} />,
      meta: { priority: 1, align: 'right', width: 88, card: 'hidden' },
    }),
    col.accessor('pageviews', {
      id: 'pages',
      header: 'Pages',
      cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
      meta: { priority: 3, kind: 'number', align: 'right', width: 64, card: 'hidden' },
    }),
    col.accessor((row) => formatPaths(row.entryPath, row.exitPath), {
      id: 'paths',
      header: 'Entry → exit',
      cell: (info) => <span className="font-mono text-[12.5px] break-all">{info.getValue()}</span>,
      meta: { priority: 1, label: 'Entry and exit', width: 220, card: 'meta' },
    }),
    col.accessor((row) => formatPlace(row), {
      id: 'place',
      header: 'Place',
      cell: (info) => <PlaceCell row={info.row.original} />,
      meta: { priority: 2, kind: 'country', width: 140, card: 'subtitle' },
    }),
    col.accessor((row) => formatDevice(row), {
      id: 'device',
      header: 'Device',
      cell: (info) => <span className="truncate">{info.getValue()}</span>,
      meta: { priority: 3, width: 140, card: 'hidden' },
    }),
    col.accessor((row) => formatSource(row), {
      id: 'source',
      header: 'Source',
      cell: (info) => <span className="truncate">{info.getValue()}</span>,
      meta: { priority: 3, width: 140, card: 'hidden' },
    }),
    col.accessor('ip', {
      id: 'ip',
      header: 'IP',
      cell: (info) => <IpCell row={info.row.original} />,
      meta: { priority: 1, kind: 'ip', width: 170, card: 'meta' },
    }),
    col.accessor('userId', {
      id: 'user',
      header: 'User',
      cell: (info) => <UserCell userId={info.getValue()} canOpenUsers={canOpenUsers} />,
      meta: { priority: 3, width: 104, card: 'hidden' },
    }),
  ]);
}
