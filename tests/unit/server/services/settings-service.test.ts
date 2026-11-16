import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_TRACKING_SETTINGS } from '@/server/analytics/model';
import type { AdminContext } from '@/server/auth/types';
import { ConflictError } from '@/server/errors';
import { SettingsService, type AdminSettings } from '@/server/services/settings-service';
import { MemorySettingsStore } from '../../../support/in-memory/memory-settings';

// 15-settings.md "Actions": settings.update with before/after, conflict on
// updated_at, no write when nothing changed.

const NOW = Date.parse('2026-11-16T10:00:00.000Z');
const owner: AdminContext = { uid: 'uidOwnerAAAAAAAAAAAAAAAAAAAA', email: 'owner@example.com', role: 'owner', authTime: 1 };
const stored: AdminSettings = { trackingEnabled: true, consentMode: 'eu_uk', ipRetentionDays: 30, rawRetentionDays: 90 };

let store: MemorySettingsStore;
let service: SettingsService;

beforeEach(() => {
  store = new MemorySettingsStore();
  service = new SettingsService({ store, now: () => NOW });
});

describe('SettingsService', () => {
  it('missing doc → code defaults, marked not stored', async () => {
    expect(await service.get()).toEqual({ values: DEFAULT_TRACKING_SETTINGS, exists: false, updatedAt: null, updatedBy: null });
  });

  it('first save stores every field and audits all of them', async () => {
    const result = await service.update(owner, { ...DEFAULT_TRACKING_SETTINGS }, null);
    expect(result).toEqual({ ok: true, data: { changed: ['trackingEnabled', 'consentMode', 'ipRetentionDays', 'rawRetentionDays'], updatedAt: NOW } });
    expect(store.doc).toMatchObject({ values: DEFAULT_TRACKING_SETTINGS, updatedBy: owner.uid });
    expect(store.audit).toHaveLength(1);
  });

  it('writes settings.update with only the changed fields, before and after, by doc field name', async () => {
    store.doc = { values: { ...stored }, updatedAt: new Date(NOW - 60_000), updatedBy: 'someone', quota: { writes_cap: 1000 } };
    const next = { ...stored, trackingEnabled: false, rawRetentionDays: 30 };
    const result = await service.update(owner, next, NOW - 60_000, { request: { ip: '192.0.2.1', userAgent: 'ua' } });
    expect(result).toEqual({ ok: true, data: { changed: ['trackingEnabled', 'rawRetentionDays'], updatedAt: NOW } });
    expect(store.audit).toEqual([
      expect.objectContaining({
        action: 'settings.update',
        actorUid: owner.uid,
        actorRole: 'owner',
        targetType: 'settings',
        targetId: 'admin_config/settings',
        before: { tracking_enabled: true, raw_retention_days: 90 },
        after: { tracking_enabled: false, raw_retention_days: 30 },
        ip: '192.0.2.1',
      }),
    ]);
    // Other fields of the doc (the quota caps) are left alone.
    expect(store.doc?.quota).toEqual({ writes_cap: 1000 });
    expect(store.doc?.updatedAt?.getTime()).toBe(NOW);
  });

  it('nothing changed → no write and no audit row', async () => {
    store.doc = { values: { ...stored }, updatedAt: new Date(NOW - 1), updatedBy: 'x' };
    expect(await service.update(owner, { ...stored }, NOW - 1)).toEqual({ ok: true, data: { changed: [], updatedAt: NOW - 1 } });
    expect(store.writes).toBe(0);
    expect(store.audit).toEqual([]);
  });

  it('doc changed since the form loaded → ConflictError, nothing written', async () => {
    store.doc = { values: { ...stored }, updatedAt: new Date(NOW - 1), updatedBy: 'other-owner' };
    for (const expected of [NOW - 2, null]) {
      const result = await service.update(owner, { ...stored, trackingEnabled: false }, expected);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(ConflictError);
      expect(result.error.message).toBe('Settings were changed by someone else. Reload to see them.');
    }
    expect(store.doc.values.trackingEnabled).toBe(true);
    expect(store.audit).toEqual([]);
  });
});
