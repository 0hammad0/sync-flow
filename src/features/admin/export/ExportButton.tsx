'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Download } from 'lucide-react';
import AdminButton from '@/shared/ui/AdminButton';
import type { ExportTable } from './tables';

// The confirm dialog is its own chunk, fetched on hover, focus or first click
// (05-performance-budget.md "CSV dialog").
const loadDialog = () => import('./ExportDialog');
const ExportDialog = dynamic(loadDialog, { ssr: false });

type ExportButtonProps = {
  table: ExportTable;
  /** `can(role, 'export:csv')`. False renders nothing (08-tables.md: hidden without permission). */
  canExport: boolean;
  /** Layout only. */
  className?: string;
};

/**
 * "Export CSV" for a screen. Exports what the screen shows: it sends the
 * current URL params (range, filters, search, sort, tab) to
 * `/api/admin/export/{table}`, which checks the permission and the params
 * again. The dialog counts the rows first, then downloads.
 */
export default function ExportButton({ table, canExport, className }: ExportButtonProps) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  // One dialog per press, keyed, so every open counts the filters of that moment.
  const [press, setPress] = useState<{ n: number; search: string } | null>(null);

  if (!canExport) return null;

  return (
    <>
      <AdminButton
        icon={Download}
        className={className}
        onPointerEnter={() => void loadDialog()}
        onFocus={() => void loadDialog()}
        onClick={() => {
          setPress((p) => ({ n: (p?.n ?? 0) + 1, search: searchParams.toString() }));
          setOpen(true);
        }}
      >
        Export CSV
      </AdminButton>
      {press && <ExportDialog key={press.n} table={table} search={press.search} open={open} onOpenChange={setOpen} />}
    </>
  );
}
