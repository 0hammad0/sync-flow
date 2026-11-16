import 'server-only';

import { DEFAULT_TRACKING_SETTINGS, type TrackingSettings } from '@/server/analytics/model';
import type { AdminContext } from '@/server/auth/types';
import { ConflictError, err, ok, type Result } from '@/server/errors';
import type { NewAuditEntry } from '@/server/repositories/interfaces';
import { buildAuditEntry, type AuditRequestInfo } from '@/server/services/audit-service';

/**
 * `admin_config/settings` for the Settings screen (15-settings.md). Same four
 * fields the tracker reads (`EventRepository.readTrackingSettings`, ingest's
 * 60 s SettingsCache, the retention cron), stored with the same snake_case
 * names, so a save is picked up by every reader on its next load. Other
 * fields in the doc (`quota.*`) are never touched: writes merge.
 */

export type AdminSettings = TrackingSettings;

/** The doc field for each setting. */
export const SETTINGS_FIELDS = {
  trackingEnabled: 'tracking_enabled',
  consentMode: 'consent_mode',
  ipRetentionDays: 'ip_retention_days',
  rawRetentionDays: 'raw_retention_days',
} as const satisfies Record<keyof AdminSettings, string>;

const SETTING_KEYS = Object.keys(SETTINGS_FIELDS) as (keyof AdminSettings)[];

export type StoredSettings = {
  /** Code defaults for missing fields. */
  values: AdminSettings;
  /** False when the doc does not exist ("Using defaults. Save to store them."). */
  exists: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
};

export type SettingsWrite = {
  values: AdminSettings;
  /** `updated_at` (ms) the form was loaded with; null = loaded without one. */
  expectedUpdatedAt: number | null;
  actorUid: string;
  now: Date;
  /** Built from the stored doc read inside the transaction. Null = nothing changed: write nothing. */
  audit: (before: StoredSettings) => NewAuditEntry | null;
};

export type SettingsWriteOutcome = 'saved' | 'unchanged' | 'conflict';

/** Storage for the settings doc. Firestore in production, a fake in tests. */
export interface SettingsStore {
  /** 1 read. */
  read(): Promise<StoredSettings>;
  /**
   * One transaction: read the doc, refuse if its `updated_at` is not the
   * expected one, else merge the four fields + `updated_at` / `updated_by`
   * and append the audit row. 1 read + 2 writes when saved, 1 read otherwise.
   */
  write(input: SettingsWrite): Promise<SettingsWriteOutcome>;
}

export type SettingsSaveResult = { changed: (keyof AdminSettings)[]; updatedAt: number | null };

export function defaultSettings(): AdminSettings {
  return { ...DEFAULT_TRACKING_SETTINGS };
}

/** Changed settings, in a stable order. */
export function diffSettings(before: AdminSettings, after: AdminSettings): (keyof AdminSettings)[] {
  return SETTING_KEYS.filter((key) => before[key] !== after[key]);
}

/** `{ tracking_enabled: true, … }` for the changed keys only. */
function pick(values: AdminSettings, keys: readonly (keyof AdminSettings)[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [SETTINGS_FIELDS[key], values[key]]));
}

export class SettingsService {
  private readonly now: () => number;

  constructor(private readonly deps: { store: SettingsStore; now?: () => number }) {
    this.now = deps.now ?? Date.now;
  }

  get(): Promise<StoredSettings> {
    return this.deps.store.read();
  }

  /**
   * Saves the four settings and writes `settings.update` with the changed
   * fields' before / after values, in one transaction. Nothing changed →
   * no write, no audit row. Saves are always allowed at the quota cap (rule
   * 8: the owner must be able to switch tracking off); they still count.
   */
  async update(
    ctx: AdminContext,
    values: AdminSettings,
    expectedUpdatedAt: number | null,
    opts: { request?: AuditRequestInfo } = {},
  ): Promise<Result<SettingsSaveResult>> {
    const now = new Date(this.now());
    let changed: (keyof AdminSettings)[] = [];
    const outcome = await this.deps.store.write({
      values,
      expectedUpdatedAt,
      actorUid: ctx.uid,
      now,
      audit: (before) => {
        // No doc yet: every field is stored for the first time ("Save to store them").
        changed = before.exists ? diffSettings(before.values, values) : [...SETTING_KEYS];
        if (changed.length === 0) return null;
        return buildAuditEntry({
          ctx,
          action: 'settings.update',
          target: { type: 'settings', id: 'admin_config/settings' },
          before: pick(before.values, changed),
          after: pick(values, changed),
          request: opts.request,
        });
      },
    });
    if (outcome === 'conflict') {
      return err(new ConflictError('Settings were changed by someone else. Reload to see them.'));
    }
    if (outcome === 'unchanged') return ok({ changed: [], updatedAt: expectedUpdatedAt });
    return ok({ changed, updatedAt: now.getTime() });
  }
}
