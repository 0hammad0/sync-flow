'use client';

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { Plus } from 'lucide-react';
import { blockedError } from '@/shared/lib/blocked';
import { BLOCK_STATUSES, BLOCK_TYPE_LABELS, BLOCK_TYPES, type BlockStatusParam, type BlockType } from '@/shared/lib/block-values';
import Badge from '@/shared/ui/Badge';
import NoBlocks from '@/shared/ui/illustrations/NoBlocks';
import Select from '@/shared/ui/Select';
import SegmentedControl from '@/shared/ui/SegmentedControl';
import Tooltip from '@/shared/ui/Tooltip';
import DataTable from '@/shared/ui/data-table/DataTable';
import { SECONDARY_BUTTON } from '@/shared/ui/data-table/styles';
import { createAdminColumnHelper, type AdminColumnDef } from '@/shared/ui/data-table/types';
import { unblockSubject } from '../actions';
import { formatExpiry, formatHits, formatUtc } from '../format';
import type { AccessActorDto, BlockCountsDto, BlockRowDto } from '../types';

// Static on purpose: a next/dynamic split here made Turbopack split the shared
// server-action runtime chunk, adding ~0.2 KiB gz to every public page.
import BlockDialog from './BlockDialog';

/** sonner loads lazily (LazyToaster), so import it on use. */
async function toast(kind: 'success' | 'error', title: string, description?: string) {
  const { toast: t } = await import('sonner');
  t[kind](title, description ? { description } : undefined);
}

const STATUS_LABELS: Record<BlockStatusParam, string> = { active: 'Active', expired: 'Expired', removed: 'Removed' };
const ALL_TYPES = 'all';
const SORT = { allowed: [] as string[], default: 'default' };

type BlocksTableProps = {
  rows: BlockRowDto[];
  counts: BlockCountsDto | null;
  status: BlockStatusParam;
  type: BlockType | null;
  page: { prevCursor: string | null; nextCursor: string | null };
  canWrite: boolean;
  /** Viewers (no ip:read) cannot search: a hit would confirm a value they cannot see. */
  canSearch: boolean;
  actor: AccessActorDto;
  error?: { reason: string; errorId?: string };
};

export default function BlocksTable({ rows, counts, status, type, page, canWrite, canSearch, actor, error }: BlocksTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Changing a filter drops `cursor` (back to the first page).
  const [, setFilters] = useQueryStates(
    {
      status: parseAsStringLiteral(BLOCK_STATUSES).withDefault('active'),
      type: parseAsStringLiteral(BLOCK_TYPES),
      cursor: parseAsString,
    },
    { shallow: false, history: 'push', startTransition },
  );

  // Unblock: the row leaves at once; if the action fails the transition
  // ends with the old rows, so it comes back (rollback) and a toast says why.
  const [visibleRows, hideRow] = useOptimistic(rows, (current, id: string) => current.filter((r) => r.id !== id));

  const unblock = (row: BlockRowDto) =>
    startTransition(async () => {
      hideRow(row.id);
      const result = await unblockSubject({ id: row.id }).catch((e: unknown) => ({
        ok: false as const,
        error: 'internal' as const,
        message: blockedError(e) ?? 'Check your connection and try again.',
      }));
      if (result.ok) {
        void toast('success', `Unblocked ${result.data.value}`);
        router.refresh();
        return;
      }
      const reason =
        result.error === 'blocked'
          ? (blockedError(result) ?? "You can't do this right now.")
          : (result.message ?? (result.error === 'not_found' ? 'This block no longer exists.' : 'Please try again.'));
      void toast('error', "Couldn't unblock", reason);
      if (result.error === 'conflict' || result.error === 'not_found') router.refresh();
    });

  const columns = useMemo(() => buildColumns(canWrite && status === 'active', unblock), [canWrite, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const newBlockButton = canWrite ? (
    <button
      type="button"
      className={`${SECONDARY_BUTTON} border-brand bg-brand text-on-brand pointer-fine:hover:bg-brand-hover`}
      onClick={() => setDialogOpen(true)}
    >
      <Plus aria-hidden="true" strokeWidth={1.75} className="size-4" />
      New block
    </button>
  ) : null;

  const toolbarFilters = (
    <>
      <SegmentedControl
        label="Block status"
        size="sm"
        value={status}
        onValueChange={(next) => void setFilters({ status: next === 'active' ? null : next, cursor: null })}
        items={BLOCK_STATUSES.map((s) => ({
          value: s,
          label: counts ? `${STATUS_LABELS[s]} ${counts[s]}` : STATUS_LABELS[s],
        }))}
      />
      <Select
        label="Type"
        hideLabel
        size="sm"
        value={type ?? ALL_TYPES}
        onValueChange={(next) => void setFilters({ type: next === ALL_TYPES ? null : (next as BlockType), cursor: null })}
        options={[
          { value: ALL_TYPES, label: 'All types' },
          ...BLOCK_TYPES.map((t) => ({ value: t, label: BLOCK_TYPE_LABELS[t] })),
        ]}
      />
    </>
  );

  return (
    <>
      <DataTable<BlockRowDto>
        label="Blocks"
        columns={columns}
        rows={visibleRows}
        getRowId={(row) => row.id}
        rowLabel={(row) => `${BLOCK_TYPE_LABELS[row.type]} ${row.value}`}
        sort={SORT}
        page={page}
        status={error ? 'error' : 'ready'}
        error={
          error
            ? { title: 'Could not load blocks.', reason: error.reason, errorId: error.errorId, onRetry: () => router.refresh() }
            : undefined
        }
        empty={
          status === 'active' && !type
            ? {
                title: 'No blocks yet.',
                body: 'Block an IP, range, country, user or device. Blocks start within 60 seconds.',
                action: newBlockButton ?? undefined,
                illustration: <NoBlocks />,
              }
            : { title: status === 'expired' ? 'No expired blocks.' : status === 'removed' ? 'No removed blocks.' : 'No blocks of this type.' }
        }
        noResults={{ title: 'No blocks match.', body: 'Search takes a full value (IP, range, country code) or a support reference.' }}
        search={canSearch ? { placeholder: 'Search value or ref…' } : undefined}
        filters={toolbarFilters}
        activeFilters={(status !== 'active' ? 1 : 0) + (type ? 1 : 0)}
        onClearFilters={() => void setFilters({ status: null, type: null, cursor: null })}
        actions={newBlockButton}
      />
      {dialogOpen && (
        <BlockDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          actor={actor}
          onCreated={(row) => {
            void toast('success', `Blocked ${row.value}`, row.expiresAt ? `Ends ${formatUtc(row.expiresAt)}` : 'Never ends.');
            router.refresh();
          }}
        />
      )}
    </>
  );
}

const col = createAdminColumnHelper<BlockRowDto>();

function buildColumns(showUnblock: boolean, unblock: (row: BlockRowDto) => void): AdminColumnDef<BlockRowDto>[] {
  const columns: AdminColumnDef<BlockRowDto>[] = col.columns([
    col.accessor('type', {
      header: 'Type',
      cell: (info) => <Badge>{BLOCK_TYPE_LABELS[info.row.original.type]}</Badge>,
      meta: { priority: 1, kind: 'badge', width: 88, card: 'subtitle' },
    }),
    col.accessor('value', {
      header: 'Value',
      cell: (info) => {
        const row = info.row.original;
        return (
          <span className="font-mono text-[13px] break-all">
            {info.getValue()}
            {row.label && <span className="ml-1.5 font-sans text-fg-muted">{row.label}</span>}
          </span>
        );
      },
      meta: { priority: 1, kind: 'ip', card: 'title' },
    }),
    col.accessor('reason', {
      header: 'Reason',
      cell: (info) => <span className="line-clamp-2">{info.getValue()}</span>,
      meta: { priority: 2, card: 'meta' },
    }),
    col.accessor('expiresAt', {
      id: 'expires',
      header: 'Expires',
      cell: (info) => {
        const value = info.getValue();
        return value ? (
          <Tooltip content={formatUtc(value)}>
            <span className="tabular-nums">{formatExpiry(value, Date.now())}</span>
          </Tooltip>
        ) : (
          'Never'
        );
      },
      meta: { priority: 1, kind: 'time', width: 104, card: 'trailing' },
    }),
    col.accessor('hits', {
      header: 'Hits',
      cell: (info) => (
        <Tooltip content="Approximate. Counted per server instance, saved every 60 s.">
          <span className="tabular-nums">{formatHits(info.getValue())}</span>
        </Tooltip>
      ),
      meta: { priority: 2, kind: 'number', align: 'right', width: 80 },
    }),
    col.accessor('createdBy', {
      header: 'Created by',
      cell: (info) => (
        <Tooltip content={formatUtc(info.row.original.createdAt)}>
          <span className="truncate">{info.getValue()}</span>
        </Tooltip>
      ),
      meta: { priority: 3, card: 'hidden' },
    }),
  ]);
  if (showUnblock) {
    columns.push(
      col.display({
        id: 'unblock',
        header: () => <span className="sr-only">Unblock</span>,
        cell: (info) => (
          <button type="button" className={SECONDARY_BUTTON} onClick={() => unblock(info.row.original)}>
            Unblock
            <span className="sr-only"> {info.row.original.value}</span>
          </button>
        ),
        meta: { priority: 1, label: 'Unblock', width: 96, align: 'right', card: 'trailing' },
      }),
    );
  }
  return columns;
}
