/**
 * Cookie names and values shared by the tracker loader (browser) and
 * `/api/e` (server). Plain data, no imports, so the loader stays tiny.
 *
 * - `sf_cr` (region / state), set by `/api/e`: `eu` = ask for consent
 *   (EU/EEA/UK), `ok` = no consent needed, `off` = visit statistics are
 *   switched off (`tracking_enabled` is false). Holds no identifier.
 * - `sf_consent`, set by the banner: `y` (Accept) or `n` (Reject).
 *   At most 13 months (CNIL limit).
 *
 * Spec: docs/admin/01-architecture/07-tracker.md, 08-privacy.md.
 */
export const REGION_COOKIE = 'sf_cr';
export const CONSENT_COOKIE = 'sf_consent';

export type Region = 'eu' | 'ok' | 'off';
export type Choice = 'y' | 'n';

/** Region answers are re-checked daily; "off" hourly, so switching tracking on reaches visitors within the hour. */
export const REGION_MAX_AGE_S = 24 * 60 * 60;
export const OFF_MAX_AGE_S = 60 * 60;
/** 390 days: under 13 months whatever the start date. */
export const CONSENT_MAX_AGE_S = 390 * 24 * 60 * 60;
