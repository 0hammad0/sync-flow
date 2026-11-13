// Pure display helpers for Files & storage (client and server).
// D-6: a file is shown as its type and size only. Nothing here takes a name.

export const FILE_TYPES = ['pdf', 'image', 'video', 'audio', 'voice', 'archive', 'document', 'other'] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const FILE_TYPE_LABELS: Record<FileType, string> = {
  pdf: 'PDF',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  voice: 'Voice',
  archive: 'Archive',
  document: 'Document',
  other: 'Other',
};

const ARCHIVES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-bzip2',
]);

const DOCUMENT_HINTS = ['msword', 'wordprocessingml', 'spreadsheetml', 'ms-excel', 'presentationml', 'ms-powerpoint', 'opendocument', 'rtf'];

/** From the stored mime type. A voice note (has `voice` metadata) is Voice; old ones without it stay Audio. */
export function fileTypeOf(mimeType: string, isVoice = false): FileType {
  const mime = mimeType.toLowerCase().split(';')[0].trim();
  if (isVoice) return 'voice';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (ARCHIVES.has(mime)) return 'archive';
  if (mime.startsWith('text/') || DOCUMENT_HINTS.some((hint) => mime.includes(hint))) return 'document';
  return 'other';
}

const UNITS = ['KB', 'MB', 'GB', 'TB'];

/** `512 B`, `2.4 MB`, `6.21 GB`. Decimal units (R2 bills in GB = 10^9). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1000) return `${Math.max(0, Math.round(bytes || 0))} B`;
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit >= 2 ? 2 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** `2,516,582 bytes` (tooltip). */
export function formatExactBytes(bytes: number): string {
  return `${Math.round(bytes).toLocaleString('en-US')} bytes`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function span(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} d`;
}

/** `5 min ago`, `2 h ago`, `3 d ago`. `nowMs` comes from the server render. */
export function formatAgo(iso: string, nowMs: number): string {
  const diff = nowMs - new Date(iso).getTime();
  return diff < MINUTE ? 'just now' : `${span(diff)} ago`;
}

export type ExpiryTone = 'none' | 'soon' | 'expired';

/** `Never`, `in 7 d`, `in 3 h` (soon: under a day), `Expired 2 d ago`. */
export function formatFileExpiry(iso: string | null, nowMs: number): { text: string; tone: ExpiryTone } {
  if (!iso) return { text: 'Never', tone: 'none' };
  const diff = new Date(iso).getTime() - nowMs;
  if (diff <= 0) return { text: `Expired ${span(-diff)} ago`, tone: 'expired' };
  return { text: `in ${span(diff)}`, tone: diff < DAY ? 'soon' : 'none' };
}

const UTC = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/** `13 Nov 2026, 12:04 UTC`. */
export function formatUtc(iso: string): string {
  return `${UTC.format(new Date(iso))} UTC`;
}

/** `0:42` for a voice note. */
export function formatVoiceDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Usage bar colour: < 70 % brand, 70–90 % amber, > 90 % red (09-files-and-storage.md). */
export function usageTone(ratio: number): 'brand' | 'warning' | 'danger' {
  if (ratio > 0.9) return 'danger';
  if (ratio >= 0.7) return 'warning';
  return 'brand';
}
