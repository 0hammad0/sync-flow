'use client';

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { Lock, Trash2 } from 'lucide-react';
import Badge from '@/shared/ui/Badge';
import EmptyFiles from '@/shared/ui/illustrations/EmptyFiles';
import SegmentedControl from '@/shared/ui/SegmentedControl';
import Select from '@/shared/ui/Select';
import Tooltip from '@/shared/ui/Tooltip';
import DataTable from '@/shared/ui/data-table/DataTable';
import { SECONDARY_BUTTON } from '@/shared/ui/data-table/styles';
import { createAdminColumnHelper, type AdminColumnDef } from '@/shared/ui/data-table/types';
import {
  FILE_TYPE_LABELS,
  formatAgo,
  formatBytes,
  formatExactBytes,
  formatFileExpiry,
  formatUtc,
} from '../format';
import { FILE_KINDS, MAX_FILES_PER_DELETE, type FileKindParam } from '../constants';
import type { FileRowDto } from '../types';
import DeleteFilesDialog, { type DeleteOutcome } from './DeleteFilesDialog';

const KIND_LABELS: Record<FileKindParam, string> = { all: 'All', share: 'Share', chat: 'Chat' };
const EXPIRY = ['any', 'expired'] as const;
const SORT = { allowed: [] as string[], default: 'default' };

/** "PDF, 2.4 MB, 2 h ago": the only way a file is named on screen (D-6). */
export function fileLabel(row: FileRowDto, nowMs: number): string {
  return `${FILE_TYPE_LABELS[row.type]}, ${formatBytes(row.size)}, ${formatAgo(row.createdAt, nowMs)}`;
}

type FilesTableProps = {
  rows: FileRowDto[];
  kind: FileKindParam;
  expired: boolean;
  page: { prevCursor: string | null; nextCursor: string | null };
  canDelete: boolean;
  /** Epoch ms of the server render, so relative times match on hydration. */
  now: number;
  error?: { title: string; reason: string; errorId?: string };
};

type Pending = { ids: string[]; label: string; clear?: () => void };

export default function FilesTable({ rows, kind, expired, page, canDelete, now, error }: FilesTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<Pending | null>(null);
  // Changing a filter drops `cursor` (back to the first page).
  const [, setFilters] = useQueryStates(
    { kind: parseAsStringLiteral(FILE_KINDS).withDefault('all'), expired: parseAsString, cursor: parseAsString },
    { shallow: false, history: 'push', startTransition },
  );

  // Deleted rows leave at once; the refresh brings the server's truth back.
  const [visibleRows, hideRows] = useOptimistic(rows, (current, ids: string[]) => current.filter((r) => !ids.includes(r.id)));

  const onDone = ({ deleted, gone }: DeleteOutcome) => {
    pending?.clear?.();
    startTransition(() => {
      hideRows([...deleted, ...gone]);
      router.refresh();
    });
  };

  const columns = useMemo(() => buildColumns(now), [now]);
  const effectiveKind = expired ? 'share' : kind;

  const filters = (
    <>
      <SegmentedControl
        label="File kind"
        size="sm"
        value={effectiveKind}
        onValueChange={(next) =>
          // Expired applies to share files only, so picking Chat clears it.
          void setFilters(next === 'chat' ? { kind: next, expired: null, cursor: null } : { kind: next === 'all' ? null : next, cursor: null })
        }
        items={FILE_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
      />
      <Select
        label="Expiry"
        hideLabel
        size="sm"
        value={expired ? 'expired' : 'any'}
        onValueChange={(next) => void setFilters({ expired: next === 'expired' ? '1' : null, cursor: null })}
        options={EXPIRY.map((v) => ({ value: v, label: v === 'expired' ? 'Expired shares' : 'Any expiry' }))}
      />
    </>
  );

  return (
    <>
      <DataTable<FileRowDto>
        label="Files"
        columns={columns}
        rows={visibleRows}
        getRowId={(row) => row.id}
        rowLabel={(row) => fileLabel(row, now)}
        rowHref={(row) => `/admin/files/${row.id}`}
        sort={SORT}
        page={page}
        status={error ? 'error' : 'ready'}
        error={error ? { ...error, onRetry: () => router.refresh() } : undefined}
        empty={{
          title: 'No files stored yet.',
          body: 'Files appear when someone shares a file or sends one in a chat.',
          illustration: <EmptyFiles />,
        }}
        noResults={{ title: 'No files match these filters.' }}
        filters={filters}
        activeFilters={(kind !== 'all' ? 1 : 0) + (expired ? 1 : 0)}
        onClearFilters={() => void setFilters({ kind: null, expired: null, cursor: null })}
        rowActions={
          canDelete
            ? (row) => [
                {
                  type: 'item',
                  label: 'Delete file',
                  icon: Trash2,
                  tone: 'danger',
                  onSelect: () => setPending({ ids: [row.id], label: `${FILE_TYPE_LABELS[row.type]} file (${formatBytes(row.size)})` }),
                },
              ]
            : undefined
        }
        bulkActions={
          canDelete
            ? (selection, clear) =>
                selection.allMatching ? null : (
                  <button
                    type="button"
                    disabled={selection.ids.length > MAX_FILES_PER_DELETE}
                    title={selection.ids.length > MAX_FILES_PER_DELETE ? `Select ${MAX_FILES_PER_DELETE} files or fewer.` : undefined}
                    className={`${SECONDARY_BUTTON} border-danger text-danger-text disabled:cursor-not-allowed disabled:opacity-50`}
                    onClick={() => setPending({ ids: selection.ids, label: `${selection.ids.length} files`, clear })}
                  >
                    <Trash2 aria-hidden="true" strokeWidth={1.75} className="size-4" />
                    Delete {selection.ids.length} {selection.ids.length === 1 ? 'file' : 'files'}
                  </button>
                )
            : undefined
        }
      />
      {pending && (
        <DeleteFilesDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          ids={pending.ids}
          label={pending.label}
          onDone={onDone}
        />
      )}
    </>
  );
}

const col = createAdminColumnHelper<FileRowDto>();

function buildColumns(now: number): AdminColumnDef<FileRowDto>[] {
  return col.columns([
    col.accessor('type', {
      header: 'Type',
      cell: (info) => {
        const row = info.row.original;
        return (
          <span className="inline-flex items-center gap-1.5">
            <Badge>{FILE_TYPE_LABELS[row.type]}</Badge>
            {row.isEncrypted && (
              <Tooltip content="Encrypted in the browser before upload.">
                <Lock aria-label="Encrypted" strokeWidth={1.75} className="size-3.5 text-fg-muted" />
              </Tooltip>
            )}
          </span>
        );
      },
      meta: { priority: 1, kind: 'badge', width: 112, card: 'title' },
    }),
    col.accessor('size', {
      header: 'Size',
      cell: (info) => (
        <Tooltip content={formatExactBytes(info.getValue())}>
          <span className="tabular-nums">{formatBytes(info.getValue())}</span>
        </Tooltip>
      ),
      meta: { priority: 1, kind: 'number', align: 'right', width: 96, card: 'trailing' },
    }),
    col.accessor((row) => row.uploader.label, {
      id: 'uploader',
      header: 'Uploader',
      cell: (info) => <span className="truncate">{info.getValue()}</span>,
      meta: { priority: 2, card: 'subtitle' },
    }),
    col.accessor((row) => row.roomCode ?? 'Share', {
      id: 'source',
      header: 'Room / link',
      cell: (info) => {
        const row = info.row.original;
        return row.roomCode ? <span className="font-mono text-[12.5px]">{row.roomCode}</span> : <span>Share</span>;
      },
      meta: { priority: 2, width: 112, card: 'meta', label: 'Room or share' },
    }),
    col.accessor('createdAt', {
      header: 'Created',
      cell: (info) => (
        <Tooltip content={formatUtc(info.getValue())}>
          <span className="tabular-nums">{formatAgo(info.getValue(), now)}</span>
        </Tooltip>
      ),
      meta: { priority: 1, kind: 'time', width: 104, card: 'meta' },
    }),
    col.accessor('expiresAt', {
      id: 'expires',
      header: 'Expires',
      cell: (info) => {
        const row = info.row.original;
        if (row.kind === 'chat') return <span className="text-fg-muted">With room</span>;
        const expiry = formatFileExpiry(info.getValue(), now);
        const tone = expiry.tone === 'expired' ? 'text-danger-text' : expiry.tone === 'soon' ? 'text-warning-text' : '';
        return <span className={`tabular-nums ${tone}`}>{expiry.tone === 'expired' ? `${expiry.text}, kept` : expiry.text}</span>;
      },
      meta: { priority: 3, kind: 'time', width: 152, card: 'hidden' },
    }),
    col.accessor('downloads', {
      header: 'Downloads',
      cell: (info) => {
        const row = info.row.original;
        if (row.downloads === null) return null;
        return <span className="tabular-nums">{row.maxDownloads ? `${row.downloads} of ${row.maxDownloads}` : row.downloads}</span>;
      },
      meta: { priority: 3, kind: 'number', align: 'right', width: 104, card: 'hidden' },
    }),
  ]);
}
