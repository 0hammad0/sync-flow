'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { formatDaySpan } from '@/features/admin/analytics/range';
import { formatNumber } from '@/features/admin/format';
import AdminButton from '@/shared/ui/AdminButton';
import Dialog from '@/shared/ui/Dialog';
import Skeleton from '@/shared/ui/Skeleton';
import { downloadCsv, fetchPreview, type ExportPreview } from './download';
import { EXPORT_NOUNS, exportHref, type ExportTable } from './tables';

// Confirm step of the CSV export (08-tables.md "CSV export"): count first,
// then "Export 1,902 sessions?". Mounted fresh for every open (the button
// keys it), so each open counts the current filters again.

type ExportDialogProps = {
  table: ExportTable;
  /** The screen's URL params when the button was pressed. */
  search: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Step =
  | { kind: 'counting' }
  | { kind: 'ready'; preview: ExportPreview }
  | { kind: 'failed'; message: string; final: boolean };

const SINGULAR: Record<string, string> = { sessions: 'session', pages: 'page', places: 'place', sources: 'source' };

/** sonner loads lazily (LazyToaster), so import it on use. */
async function toast(kind: 'success' | 'error', title: string) {
  const { toast: t } = await import('sonner');
  t[kind](title);
}

export default function ExportDialog({ table, search, open, onOpenChange }: ExportDialogProps) {
  const [step, setStep] = useState<Step>({ kind: 'counting' });
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchPreview(exportHref(table, search, { preview: '1' }), controller.signal).then(
      (result) => setStep(result.ok ? { kind: 'ready', preview: result.data } : { kind: 'failed', ...result }),
      () => {}, // aborted: the dialog closed
    );
    return () => controller.abort();
  }, [table, search, attempt]);

  const noun = EXPORT_NOUNS[table];
  const preview = step.kind === 'ready' ? step.preview : null;
  const capped = preview !== null && preview.total > preview.rows;
  const empty = preview !== null && preview.rows === 0;

  const retryCount = () => {
    setStep({ kind: 'counting' });
    setAttempt((n) => n + 1);
  };

  const download = async () => {
    if (downloading || !preview) return;
    setDownloading(true);
    setDownloadError(null);
    const result = await downloadCsv(exportHref(table, search), `syncflow-${table}.csv`);
    setDownloading(false);
    if (!result.ok) {
      if (result.final) setStep({ kind: 'failed', message: result.message, final: true });
      else setDownloadError(result.message);
      return;
    }
    onOpenChange(false);
    void toast('success', 'Export started');
  };

  const close = (next: boolean) => {
    if (downloading && !next) return;
    onOpenChange(next);
  };

  let title = 'Export CSV';
  let body: ReactNode;
  let footer: ReactNode;
  const cancel = (
    <AdminButton onClick={() => close(false)} disabled={downloading}>
      Cancel
    </AdminButton>
  );
  const closeButton = <AdminButton onClick={() => close(false)}>Close</AdminButton>;

  if (step.kind === 'counting') {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2 py-1">
        <span className="sr-only">Counting rows</span>
        <Skeleton className="w-3/4" />
        <Skeleton className="w-1/2" />
      </div>
    );
    footer = (
      <>
        {cancel}
        <AdminButton variant="primary" loading>
          Export
        </AdminButton>
      </>
    );
  } else if (step.kind === 'failed') {
    title = step.final ? "Can't export now" : 'Export CSV';
    body = (
      <p role="alert" className="text-danger-text">
        {step.message}
      </p>
    );
    footer = step.final ? (
      closeButton
    ) : (
      <>
        {cancel}
        <AdminButton variant="primary" onClick={retryCount}>
          Try again
        </AdminButton>
      </>
    );
  } else if (empty) {
    title = 'Nothing to export';
    body = <p className="text-fg-muted">No {noun} match this range and these filters.</p>;
    footer = closeButton;
  } else if (preview) {
    const count = formatNumber(preview.rows);
    const span = formatDaySpan(preview.from, preview.to);
    title = capped ? `Export the first ${count} ${noun}?` : `Export ${count} ${preview.rows === 1 ? SINGULAR[noun] : noun}?`;
    body = (
      <div className="flex flex-col gap-2">
        {capped ? (
          <p>
            This export has {formatNumber(preview.total)} rows. The limit is {formatNumber(preview.limit)}. Narrow the
            date range or filters to get the rest.
          </p>
        ) : null}
        <p className="text-fg-muted">{span}, with the filters on this screen. Times are in UTC.</p>
        {downloadError && (
          <p role="alert" className="text-danger-text">
            {downloadError}
          </p>
        )}
      </div>
    );
    footer = (
      <>
        {cancel}
        <AdminButton variant="primary" loading={downloading} loadingText="Exporting" onClick={download}>
          {downloadError ? 'Try again' : capped ? `Export first ${count}` : 'Export'}
        </AdminButton>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close} title={title} size="sm" footer={footer}>
      {body}
    </Dialog>
  );
}
