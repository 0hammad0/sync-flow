import type { ReactNode } from 'react';
import { EyeOff } from 'lucide-react';
import {
  FILE_TYPE_LABELS,
  formatBytes,
  formatExactBytes,
  formatFileExpiry,
  formatUtc,
  formatVoiceDuration,
} from '../format';
import type { FileRowDto } from '../types';

// One file's metadata for the drawer and the full page (09-files-and-storage.md
// "Detail drawer"). No preview, no download, no link, no name [D-4, D-6].
// No hooks: renders on the server inside either shell.

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 py-2 text-sm">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

export function fileTitle(file: Pick<FileRowDto, 'type'>): string {
  return `${FILE_TYPE_LABELS[file.type]} file`;
}

export default function FileDetail({ file, now, actions }: { file: FileRowDto; now: number; actions?: ReactNode }) {
  const expiry = file.kind === 'share' ? formatFileExpiry(file.expiresAt, now) : null;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg">
        {FILE_TYPE_LABELS[file.type]} · {formatBytes(file.size)}{' '}
        <span className="text-fg-muted tabular-nums">({formatExactBytes(file.size)})</span>
      </p>
      <p className="flex items-center gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-fg-muted">
        <EyeOff aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
        File content and names are never shown in the admin.
      </p>
      <dl className="divide-y divide-edge">
        <Row label="Uploader">
          {file.uploader.label}
          {file.uploader.uid && <span className="ml-1.5 font-mono text-xs text-fg-muted">{file.uploader.uid.slice(0, 8)}…</span>}
        </Row>
        <Row label="Kind">{file.kind === 'share' ? 'Share' : <>Chat · room <span className="font-mono">{file.roomCode}</span></>}</Row>
        <Row label="Mime type">
          <span className="font-mono text-xs">{file.mimeType}</span>
        </Row>
        <Row label="Created">{formatUtc(file.createdAt)}</Row>
        {expiry && (
          <Row label="Expires">
            {file.expiresAt ? `${formatUtc(file.expiresAt)} (${expiry.text})` : 'Never'}
          </Row>
        )}
        {file.downloads !== null && (
          <Row label="Downloads">{file.maxDownloads ? `${file.downloads} of ${file.maxDownloads}` : file.downloads}</Row>
        )}
        {file.voiceDurationMs !== null && <Row label="Length">{formatVoiceDuration(file.voiceDurationMs)}</Row>}
        <Row label="Encrypted">{file.isEncrypted ? 'Yes, in the browser' : 'No'}</Row>
        <Row label="Storage">Cloudflare R2</Row>
      </dl>
      {actions && <div className="flex justify-end">{actions}</div>}
    </div>
  );
}
