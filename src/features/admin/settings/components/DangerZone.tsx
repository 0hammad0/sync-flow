'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Search, Trash2 } from 'lucide-react';
import { formatNumber } from '@/features/admin/format';
import type { ActionResult } from '@/server/errors';
import { blockedError } from '@/shared/lib/blocked';
import AdminButton from '@/shared/ui/AdminButton';
import ConfirmDialog, { type ConfirmResult } from '@/shared/ui/ConfirmDialog';
import Input from '@/shared/ui/Input';
import { deleteSubjectData, previewSubjectData } from '../actions';
import { SETTINGS_MESSAGES, canExportSubject, parseSubject, subjectExportSearch, type DataSubject } from '../constants';
import type { SubjectDeleteDto, SubjectPreviewDto } from '../types';

// The phase 3 CSV export dialog, reused for a subject export ("Export and
// delete on request", 08-privacy.md). Own chunk, fetched on first use.
const loadExportDialog = () => import('@/features/admin/export/ExportDialog');
const ExportDialog = dynamic(loadExportDialog, { ssr: false });

async function toast(kind: 'success' | 'error', title: string) {
  const { toast: t } = await import('sonner');
  t[kind](title);
}

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

function failureText(result: Failure): string {
  if (result.error === 'blocked') return blockedError(result) ?? "You can't do this right now.";
  if (result.message) return result.message;
  if (result.error === 'forbidden') return 'Only owners can delete visitor data.';
  if (result.error === 'invalid') return Object.values(result.fields ?? {})[0]?.[0] ?? SETTINGS_MESSAGES.subject;
  return `Something went wrong. Try again.${result.errorId ? ` Error id ${result.errorId}.` : ''}`;
}

const networkFailure = (e: unknown): Failure => ({
  ok: false,
  error: 'internal',
  message: blockedError(e) ?? 'Check your connection and try again.',
});

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

function reportText(r: SubjectDeleteDto, label: string): string {
  const done = `Deleted ${plural(r.deleted, 'session', 'sessions')} for ${label}`;
  if (r.complete) return `${done}.`;
  if (r.stopped === 'cap') return `${done} of ${formatNumber(r.needed)}. Stopped: today's delete budget is nearly used up. Run it again after 00:00 UTC.`;
  return `${done} of ${formatNumber(r.needed)}. Stopped on an error${r.errorId ? ` (error id ${r.errorId})` : ''}. Run it again.`;
}

type Props = {
  rawRetentionDays: number | null;
  ipRetentionDays: number | null;
  /** `can(role, 'export:csv')`. */
  canExport: boolean;
};

/**
 * Delete all analytics for one IP or user (15-settings.md "Danger zone").
 * Find data counts first; Delete all needs the value typed again. The
 * server counts again, refuses if today's delete budget cannot cover it,
 * and stops early (reporting a partial delete) rather than pass the cap.
 */
export default function DangerZone({ rawRetentionDays, ipRetentionDays, canExport }: Props) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [preview, setPreview] = useState<SubjectPreviewDto | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // What the open confirm dialog deletes. Kept apart from `preview`, which clears on success while the dialog closes.
  const [target, setTarget] = useState<{ subject: DataSubject; sessions: number } | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [exportPress, setExportPress] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);

  const find = async () => {
    if (finding) return;
    const subject = parseSubject(text);
    if (!subject) {
      setInputError(SETTINGS_MESSAGES.subject);
      return;
    }
    setInputError(null);
    setFindError(null);
    setReport(null);
    setPreview(null);
    setFinding(true);
    const result = await previewSubjectData({ subject: text }).catch(networkFailure);
    setFinding(false);
    if (result.ok) setPreview(result.data);
    else setFindError(failureText(result));
  };

  const remove = async (): Promise<ConfirmResult> => {
    if (!target) return { ok: false, error: 'invalid' };
    const value = target.subject.value;
    const result = await deleteSubjectData({ subject: value, confirm: value }).catch(networkFailure);
    if (!result.ok) return { ok: false, error: result.error, message: failureText(result) };
    const message = reportText(result.data, value);
    setReport(message);
    setPreview(null);
    void toast(result.data.complete ? 'success' : 'error', message);
    router.refresh();
    return { ok: true };
  };

  const subject = preview?.subject ?? null;
  const windowText = rawRetentionDays ? ` (last ${rawRetentionDays} days)` : '';

  return (
    <section
      id="danger"
      aria-labelledby="danger-heading"
      className="flex scroll-mt-20 flex-col gap-4 rounded-lg border border-danger p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="danger-heading" className="text-[15px] font-semibold text-danger-text">
          Danger zone
        </h2>
        <p className="text-sm text-fg-muted">
          Delete all analytics for an IP or a user: their sessions with every page view and click inside them. Daily totals
          hold no IP or account and stay.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <Input
          className="flex-1"
          label="IP address or user id"
          hideLabel
          placeholder="IP or uid…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setInputError(null);
          }}
          error={inputError ?? undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <AdminButton type="submit" icon={Search} loading={finding} loadingText="Finding…">
          Find data
        </AdminButton>
      </form>

      {findError && (
        <p role="alert" className="text-sm text-danger-text">
          {findError}
        </p>
      )}
      {report && (
        <p role="status" className="text-sm text-fg">
          {report}
        </p>
      )}

      {preview && subject && (
        <div role="status" className="flex flex-col gap-3 rounded-md bg-surface-2 p-3 text-sm">
          {preview.sessions === 0 ? (
            <p className="text-fg">No analytics data for this IP or user.</p>
          ) : (
            <>
              <p className="text-fg">
                Found {plural(preview.sessions, 'session', 'sessions')} for{' '}
                <strong className="font-mono font-semibold break-all">{subject.value}</strong>
                {windowText}. Their page views and clicks are stored inside them and go with them.
              </p>
              {subject.kind === 'ip' && (
                <p className="text-xs text-fg-muted">
                  Matches sessions that still hold this exact IP
                  {ipRetentionDays ? ` (full IPs are kept ${ipRetentionDays} days)` : ''}. Older sessions keep only a shortened
                  IP and are not matched.
                </p>
              )}
              {!preview.fits && (
                <p className="text-sm text-warning-text">
                  This needs {formatNumber(preview.sessions)} deletes; {formatNumber(preview.deletesLeft)} are left today. Try
                  again after 00:00 UTC.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <AdminButton variant="danger-solid" icon={Trash2} disabled={!preview.fits} onClick={() => {
                    setTarget({ subject, sessions: preview.sessions });
                    setConfirmOpen(true);
                  }}
                >
                  Delete all
                </AdminButton>
                {canExport && canExportSubject(subject) && (
                  <AdminButton
                    icon={Download}
                    onPointerEnter={() => void loadExportDialog()}
                    onFocus={() => void loadExportDialog()}
                    onClick={() => {
                      setExportPress((n) => n + 1);
                      setExportOpen(true);
                    }}
                  >
                    Export CSV
                  </AdminButton>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {target && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          tone="danger"
          title={`Delete all analytics for ${target.subject.value}?`}
          consequence={`${plural(target.sessions, 'session', 'sessions')} with their page views and clicks are deleted for good. Daily totals stay.`}
          confirmLabel="Delete all"
          typeToConfirm={target.subject.value}
          onConfirm={remove}
        />
      )}
      {subject && exportPress > 0 && (
        <ExportDialog
          key={exportPress}
          table="sessions"
          search={subjectExportSearch(subject)}
          open={exportOpen}
          onOpenChange={setExportOpen}
        />
      )}
    </section>
  );
}
