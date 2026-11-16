import { beforeEach, describe, expect, it, vi } from 'vitest';

import { can } from '@/server/auth/permissions';
import type { AdminContext } from '@/server/auth/types';
import { ForbiddenError, UnauthorizedError } from '@/server/errors';
import { AuditService } from '@/server/services/audit-service';
import { DataDeletionService } from '@/server/services/data-deletion-service';
import { SettingsService } from '@/server/services/settings-service';
import { FakeQuota, MemorySettingsStore, MemorySubjectStore } from '../../support/in-memory/memory-settings';
import { MemoryAuditRepository } from '../../support/memory-audit-repository';

// The Settings server actions over in-memory stores: requireAdmin
// ('settings:write') first → block check → zod → service → audit.

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  assertNotBlocked: vi.fn(),
  updateTag: vi.fn(),
  flush: vi.fn(async () => {}),
  parts: null as unknown,
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '192.0.2.50', 'user-agent': 'test-agent' }),
}));
vi.mock('next/cache', () => ({ updateTag: mocks.updateTag, unstable_cache: <T>(fn: T) => fn }));
vi.mock('@/server/auth/require-admin', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/server/blocklist/assert-not-blocked', () => ({ assertNotBlocked: mocks.assertNotBlocked }));
vi.mock('@/server/container', () => ({
  getSettingsParts: () => mocks.parts,
  getContainer: () => ({ quota: { flush: mocks.flush } }),
}));
// actions.ts imports ROLLUPS_TAG only; skip the analytics query module's container wiring.
vi.mock('@/features/admin/analytics/queries', () => ({ ROLLUPS_TAG: 'rollups' }));

const { updateSettings, previewSubjectData, deleteSubjectData } = await import('@/features/admin/settings/actions');
const { createRequireAdmin } = await vi.importActual<typeof import('@/server/auth/require-admin')>('@/server/auth/require-admin');

const IP = '203.0.113.9';
const owner: AdminContext = { uid: 'uidOwnerAAAAAAAAAAAAAAAAAAAA', email: 'owner@example.com', role: 'owner', authTime: 1 };
const valid = { trackingEnabled: false, consentMode: 'all', ipRetentionDays: 7, rawRetentionDays: 30, expectedUpdatedAt: null };

let settingsStore: MemorySettingsStore;
let subjects: MemorySubjectStore;
let quota: FakeQuota;
let audit: MemoryAuditRepository;

beforeEach(() => {
  vi.clearAllMocks();
  settingsStore = new MemorySettingsStore();
  quota = new FakeQuota();
  subjects = new MemorySubjectStore(quota);
  for (let i = 0; i < 4; i += 1) subjects.sessions.push({ id: `s${i}`, ip: IP, user_id: null });
  subjects.sessions.push({ id: 'other', ip: '198.51.100.1', user_id: null });
  audit = new MemoryAuditRepository();
  mocks.parts = {
    settings: new SettingsService({ store: settingsStore }),
    deletion: new DataDeletionService({ store: subjects, quota, audit: new AuditService(audit), logger: { error: vi.fn() } }),
  };
  mocks.requireAdmin.mockResolvedValue(owner);
  mocks.assertNotBlocked.mockResolvedValue(null);
});

const ACTIONS = [
  ['updateSettings', () => updateSettings(valid)],
  ['previewSubjectData', () => previewSubjectData({ subject: IP })],
  ['deleteSubjectData', () => deleteSubjectData({ subject: IP, confirm: IP })],
] as const;

describe('settings actions: permission and order', () => {
  it.each(ACTIONS)('%s calls requireAdmin(settings:write) before the block check', async (_name, run) => {
    const order: string[] = [];
    mocks.requireAdmin.mockImplementation(async () => (order.push('auth'), owner));
    mocks.assertNotBlocked.mockImplementation(async () => (order.push('block'), null));
    expect((await run()).ok).toBe(true);
    expect(mocks.requireAdmin).toHaveBeenCalledWith('settings:write');
    expect(order).toEqual(['auth', 'block']);
  });

  it.each(ACTIONS)('%s refuses a moderator / viewer (403) and a signed-out caller (401) with no side effect', async (_name, run) => {
    mocks.requireAdmin.mockRejectedValueOnce(new ForbiddenError({ permission: 'settings:write' }));
    expect(await run()).toEqual({ ok: false, error: 'forbidden' });
    mocks.requireAdmin.mockRejectedValueOnce(new UnauthorizedError('no_session'));
    expect(await run()).toEqual({ ok: false, error: 'unauthorized' });
    expect(mocks.assertNotBlocked).not.toHaveBeenCalled();
    expect(settingsStore.doc).toBeNull();
    expect(subjects.sessions).toHaveLength(5);
    expect(await audit.list({ limit: 10 })).toMatchObject({ entries: [] });
  });

  it.each(ACTIONS)('%s stops a blocked admin', async (_name, run) => {
    mocks.assertNotBlocked.mockResolvedValue({ ref: 'REF9' });
    expect(await run()).toEqual({ ok: false, error: 'blocked', ref: 'REF9' });
    expect(settingsStore.doc).toBeNull();
    expect(subjects.sessions).toHaveLength(5);
  });

  it('settings:write is owner only in the permission map, and the real requireAdmin answers 403 for a moderator', async () => {
    expect(can('owner', 'settings:write')).toBe(true);
    expect(can('moderator', 'settings:write')).toBe(false);
    expect(can('viewer', 'settings:write')).toBe(false);
    for (const role of ['moderator', 'viewer']) {
      const { requireAdmin } = createRequireAdmin({
        readSessionCookie: async () => 'cookie',
        verifySessionCookie: async () => ({ uid: 'u1', email: 'm@example.com', auth_time: 1, role }),
        readRequestMeta: async () => ({ ip: null, userAgent: null }),
        onDenied: () => {},
        now: () => 0,
      });
      const denied = await requireAdmin('settings:write').catch((e: unknown) => e);
      expect(denied).toBeInstanceOf(ForbiddenError);
      expect((denied as ForbiddenError).status).toBe(403);
    }
  });
});

describe('updateSettings', () => {
  it('saves, writes settings.update with before/after, and clears the settings cache tag', async () => {
    const result = await updateSettings(valid);
    expect(result).toMatchObject({ ok: true, data: { changed: expect.arrayContaining(['trackingEnabled', 'consentMode']) } });
    expect(settingsStore.doc?.values).toEqual({ trackingEnabled: false, consentMode: 'all', ipRetentionDays: 7, rawRetentionDays: 30 });
    expect(settingsStore.audit[0]).toMatchObject({ action: 'settings.update', ip: '192.0.2.50', userAgent: 'test-agent' });
    expect(mocks.updateTag).toHaveBeenCalledWith('settings');
  });

  it('refuses bad values with field errors and writes nothing', async () => {
    const result = await updateSettings({ ...valid, ipRetentionDays: 30, rawRetentionDays: 7 });
    expect(result).toEqual({ ok: false, error: 'invalid', fields: { ipRetentionDays: ['Full IPs cannot be kept longer than raw events.'] } });
    expect(await updateSettings({ ...valid, rawRetentionDays: 365 })).toMatchObject({ ok: false, error: 'invalid' });
    expect(settingsStore.doc).toBeNull();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it('a stale form gets the conflict message', async () => {
    expect((await updateSettings(valid)).ok).toBe(true);
    expect(await updateSettings({ ...valid, trackingEnabled: true })).toEqual({
      ok: false,
      error: 'conflict',
      message: 'Settings were changed by someone else. Reload to see them.',
    });
  });
});

describe('previewSubjectData / deleteSubjectData', () => {
  it('preview counts without deleting or auditing', async () => {
    expect(await previewSubjectData({ subject: ` ${IP} ` })).toEqual({
      ok: true,
      data: { subject: { kind: 'ip', value: IP }, sessions: 4, deletesLeft: expect.any(Number), fits: true },
    });
    expect(subjects.sessions).toHaveLength(5);
    expect((await audit.list({ limit: 10 })).entries).toEqual([]);
  });

  it('refuses input that is neither an IP nor a uid', async () => {
    expect(await previewSubjectData({ subject: 'not an ip' })).toEqual({
      ok: false,
      error: 'invalid',
      fields: { subject: ['Enter an IP address or a user id.'] },
    });
  });

  it('delete needs the typed value; a wrong one deletes nothing', async () => {
    expect(await deleteSubjectData({ subject: IP, confirm: '203.0.113.' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(subjects.sessions).toHaveLength(5);
  });

  it('deletes the subject’s sessions, writes data.delete, refreshes session caches and flushes the counter', async () => {
    expect(await deleteSubjectData({ subject: IP, confirm: IP })).toEqual({
      ok: true,
      data: { needed: 4, deleted: 4, complete: true, stopped: null, errorId: null },
    });
    expect(subjects.sessions.map((s) => s.id)).toEqual(['other']);
    const [row] = (await audit.list({ limit: 10 })).entries;
    expect(row).toMatchObject({ action: 'data.delete', targetType: 'ip', targetId: '203.0.113.•••', ip: '192.0.2.50' });
    expect(mocks.updateTag).toHaveBeenCalledWith('rollups');
    expect(mocks.flush).toHaveBeenCalled();
  });

  it('over the delete budget → the refusal message, nothing deleted', async () => {
    quota.used.deletes = quota.caps.deletes;
    expect(await deleteSubjectData({ subject: IP, confirm: IP })).toEqual({
      ok: false,
      error: 'conflict',
      message: 'This needs 4 deletes; 0 are left today. Try again after 00:00 UTC.',
    });
    expect(subjects.sessions).toHaveLength(5);
  });

  it('read cap used up → a budget message, not an internal error', async () => {
    quota.used.reads = quota.caps.reads;
    expect(await previewSubjectData({ subject: IP })).toEqual({
      ok: false,
      error: 'conflict',
      message: "Today's Firestore budget is used up. Try again after 00:00 UTC.",
    });
  });
});
