// Settings screen constants (15-settings.md), zod-free so client components
// can import them without pulling zod into the page's first-load JS.
// schemas.ts builds the server-side checks on these.

import { normaliseIp } from '@/shared/lib/ip';
import { maskIp, MASK } from '@/shared/lib/mask-ip';
import { UID_PATTERN } from '@/features/admin/users/constants';

/** Cache tag for every read of `admin_config/settings` on admin screens. updateSettings clears it. */
export const SETTINGS_TAG = 'settings';

/** Same values as CONSENT_MODES in src/server/analytics/model.ts (a unit test keeps them equal). */
export const CONSENT_MODE_CHOICES = ['none', 'eu_uk', 'all'] as const;
export type ConsentModeChoice = (typeof CONSENT_MODE_CHOICES)[number];

export const CONSENT_LABELS: Record<ConsentModeChoice, string> = {
  none: 'None',
  eu_uk: 'EU/UK only',
  all: 'All visitors',
};

/** "Visitors from Germany see the banner. Visitors from Pakistan do not." */
export const CONSENT_PREVIEW: Record<ConsentModeChoice, string> = {
  none: 'No visitor sees the banner.',
  eu_uk: 'Visitors from Germany see the banner. Visitors from Pakistan do not.',
  all: 'Every visitor sees the banner before visits are recorded.',
};

/** Bounds the server accepts, and the options the screen offers (15-settings.md "Data"). */
export const IP_RETENTION = { min: 1, max: 30, options: [1, 7, 14, 30] } as const;
export const RAW_RETENTION = { min: 7, max: 90, options: [7, 30, 60, 90] } as const;

export const SETTINGS_SECTIONS = ['tracking', 'retention', 'roles', 'danger'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SETTINGS_MESSAGES = {
  outOfRange: 'Pick a value from the list.',
  ipLongerThanRaw: 'Full IPs cannot be kept longer than raw events.',
  conflict: 'Settings were changed by someone else. Reload to see them.',
  subject: 'Enter an IP address or a user id.',
  confirm: 'Type the IP address or user id exactly to confirm.',
} as const;

// ---------------------------------------------------------------------------
// Danger zone subject: one IP address or one user id.

export type DataSubject = { kind: 'ip' | 'uid'; value: string };

/**
 * An IP (normalised, so `::ffff:1.2.3.4` and `1.2.3.4` match the stored
 * value) or a Firebase uid. Anything else → null. An IP is never a uid shape
 * (it has dots or colons), so the order does not matter.
 */
export function parseSubject(input: string | null | undefined): DataSubject | null {
  const text = input?.trim() ?? '';
  if (!text) return null;
  const ip = normaliseIp(text);
  if (ip) return { kind: 'ip', value: ip };
  if (UID_PATTERN.test(text)) return { kind: 'uid', value: text };
  return null;
}

/** What the audit row keeps: `39.4.2.•••` or the first 6 chars of a uid (15-settings.md). */
export function maskSubject(subject: DataSubject): string {
  return subject.kind === 'ip' ? maskIp(subject.value) : `${subject.value.slice(0, 6)}${MASK}`;
}

/**
 * The sessions CSV export (phase 3) matches a uid only in its exact 28-char
 * form (export-data.ts UID_RE); any other `q` would export every session in
 * the range. So the subject export is offered for IPs and 28-char uids only.
 */
export function canExportSubject(subject: DataSubject): boolean {
  return subject.kind === 'ip' || /^[A-Za-z0-9]{28}$/.test(subject.value);
}

/** `?q=…&range=90d` for `/api/admin/export/sessions`. The export clamps 90d to raw retention; an IP search ignores the range. */
export function subjectExportSearch(subject: DataSubject): string {
  return new URLSearchParams({ q: subject.value, range: '90d' }).toString();
}
