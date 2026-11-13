import 'server-only';

/**
 * Firestore collection names for admin and analytics data. Every one of
 * these is deny-all in firestore.rules: only the Admin SDK touches them.
 * Prefix `a_` = analytics, `admin_` = admin records.
 */
export const COLLECTIONS = {
  adminAudit: 'admin_audit',
  adminCronRuns: 'admin_cron_runs',
  adminConfig: 'admin_config',
  blocks: 'blocks',
  aSessions: 'a_sessions',
  aHourly: 'a_hourly',
  aDaily: 'a_daily',
  aCounters: 'a_counters',
  /** Room history (metadata only). The cleanup cron never deletes it. */
  aRooms: 'a_rooms',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/** Fixed document ids inside `admin_config`. */
export const ADMIN_CONFIG_DOCS = {
  settings: 'settings',
  blocklist: 'blocklist',
  roles: 'roles',
} as const;
