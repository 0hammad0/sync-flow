import 'server-only';

import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { CONSENT_MODES, DEFAULT_TRACKING_SETTINGS } from '@/server/analytics/model';
import { ADMIN_CONFIG_DOCS, COLLECTIONS } from '@/server/firestore/collections';
import type { QuotaMeter } from '@/server/quota/quota-guard';
import { toAuditDoc } from '@/server/repositories/firestore/audit-repository';
import {
  SETTINGS_FIELDS,
  type SettingsStore,
  type SettingsWrite,
  type SettingsWriteOutcome,
  type StoredSettings,
} from '@/server/services/settings-service';

/**
 * `admin_config/settings` for the Settings screen. Parsed like
 * FirestoreEventRepository.readTrackingSettings (same fields, same
 * defaults), so the screen shows what the tracker actually runs with.
 *
 * Cost: read = 1 read. write = 1 read + 2 writes (settings + audit row, one
 * transaction), or 1 read when refused / unchanged. Counted, never blocked:
 * settings saves stay allowed at the cap (03-data-model.md "Admin actions at
 * the cap").
 */

const settingsDoc = z.object({
  tracking_enabled: z.boolean().optional().catch(undefined),
  consent_mode: z.enum(CONSENT_MODES).optional().catch(undefined),
  ip_retention_days: z.number().int().positive().optional().catch(undefined),
  raw_retention_days: z.number().int().positive().optional().catch(undefined),
  updated_at: z.instanceof(Timestamp).optional().catch(undefined),
  updated_by: z.string().optional().catch(undefined),
});

export function parseSettingsDoc(exists: boolean, data: DocumentData | undefined): StoredSettings {
  const d = settingsDoc.parse(data ?? {});
  return {
    values: {
      trackingEnabled: d.tracking_enabled ?? DEFAULT_TRACKING_SETTINGS.trackingEnabled,
      consentMode: d.consent_mode ?? DEFAULT_TRACKING_SETTINGS.consentMode,
      ipRetentionDays: d.ip_retention_days ?? DEFAULT_TRACKING_SETTINGS.ipRetentionDays,
      rawRetentionDays: d.raw_retention_days ?? DEFAULT_TRACKING_SETTINGS.rawRetentionDays,
    },
    exists,
    updatedAt: d.updated_at?.toDate() ?? null,
    updatedBy: d.updated_by ?? null,
  };
}

export class FirestoreSettingsRepository implements SettingsStore {
  constructor(
    private readonly db: Firestore,
    private readonly quota: QuotaMeter,
  ) {}

  private get ref() {
    return this.db.collection(COLLECTIONS.adminConfig).doc(ADMIN_CONFIG_DOCS.settings);
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.quota.noteError(error);
      throw error;
    }
  }

  async read(): Promise<StoredSettings> {
    const snap = await this.run(() => this.ref.get());
    this.quota.record('reads', 1);
    return parseSettingsDoc(snap.exists, snap.data());
  }

  async write(input: SettingsWrite): Promise<SettingsWriteOutcome> {
    const auditRef = this.db.collection(COLLECTIONS.adminAudit).doc();
    const outcome = await this.run(() =>
      this.db.runTransaction(async (tx): Promise<SettingsWriteOutcome> => {
        const snap = await tx.get(this.ref);
        const before = parseSettingsDoc(snap.exists, snap.data());
        if ((before.updatedAt?.getTime() ?? null) !== input.expectedUpdatedAt) return 'conflict';
        const entry = input.audit(before);
        if (!entry) return 'unchanged';
        const { values } = input;
        tx.set(
          this.ref,
          {
            [SETTINGS_FIELDS.trackingEnabled]: values.trackingEnabled,
            [SETTINGS_FIELDS.consentMode]: values.consentMode,
            [SETTINGS_FIELDS.ipRetentionDays]: values.ipRetentionDays,
            [SETTINGS_FIELDS.rawRetentionDays]: values.rawRetentionDays,
            updated_at: Timestamp.fromDate(input.now),
            updated_by: input.actorUid,
          },
          // Merge: `quota.*` and any other field stay as they are.
          { merge: true },
        );
        tx.set(auditRef, toAuditDoc(entry));
        return 'saved';
      }),
    );
    this.quota.record('reads', 1);
    if (outcome === 'saved') this.quota.record('writes', 2);
    return outcome;
  }
}
