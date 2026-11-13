import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminContext } from '@/server/auth/types';
import { AUDIT_ACTIONS, type AuditEntry, type NewAuditEntry } from '@/server/repositories/interfaces';
import { AuditService } from '@/server/services/audit-service';
import { AUDIT_ACTION_LABELS, AUDIT_ACTION_LIST, isDangerAction } from '@/features/admin/audit/catalog';
import { diffAudit, formatAuditValue } from '@/features/admin/audit/diff';
import { middleTruncate } from '@/features/admin/audit/format';
import { auditParamsSchema } from '@/features/admin/audit/schemas';
import { MemoryAuditRepository } from '../../../../support/memory-audit-repository';

const state = vi.hoisted(() => ({ container: null as unknown }));
vi.mock('next/cache', () => ({ unstable_cache: <T>(fn: T) => fn, updateTag: vi.fn() }));
vi.mock('@/server/container', () => ({ getContainer: () => state.container }));

const { auditListQuery, auditScope, listAuditEntries, toAuditRowDto } = await import('@/features/admin/audit/queries');

const owner: AdminContext = { uid: 'owner1', email: 'owner@example.com', role: 'owner', authTime: 1 };
const mod: AdminContext = { uid: 'mod1', email: 'mod@example.com', role: 'moderator', authTime: 1 };
const NOW = Date.parse('2026-11-13T12:00:00.000Z');

function entry(extra: Partial<NewAuditEntry>): NewAuditEntry {
  return {
    actorUid: 'owner1',
    actorEmail: 'owner@example.com',
    actorRole: 'owner',
    action: 'block.create',
    targetType: 'ip',
    targetId: '203.0.113.7',
    before: null,
    after: null,
    reason: null,
    ip: null,
    userAgent: null,
    ...extra,
  };
}

describe('audit catalogue', () => {
  it('matches the server action list, with a label for each', () => {
    expect([...AUDIT_ACTION_LIST]).toEqual([...AUDIT_ACTIONS]);
    for (const a of AUDIT_ACTION_LIST) expect(AUDIT_ACTION_LABELS[a]).toBeTruthy();
    expect(isDangerAction('file.delete')).toBe(true);
    expect(isDangerAction('auth.denied')).toBe(true);
    expect(isDangerAction('block.create')).toBe(false);
  });
});

describe('auditScope: who sees what (enforced in the query)', () => {
  it('forces a moderator onto their own rows, whatever the URL says', () => {
    const scope = auditScope(mod, { actor: 'owner1', q: '203.0.113.7' });
    expect(scope).toEqual({ actorUid: 'mod1', action: null, targetId: null, ownOnly: true, ignored: ['actor', 'q'] });
    const q = auditListQuery(scope, '30d', null, NOW);
    expect(q.actorUid).toBe('mod1');
    expect(q.targetId).toBeUndefined();
  });

  it('lets a moderator add an action filter on top of the forced actor', () => {
    expect(auditScope(mod, { action: 'file.delete' })).toMatchObject({ actorUid: 'mod1', action: 'file.delete' });
  });

  it('gives the owner one filter at a time: q, then action, then actor', () => {
    expect(auditScope(owner, { actor: 'x', action: 'file.delete', q: 't' })).toMatchObject({ targetId: 't', action: null, actorUid: null, ignored: ['actor', 'action'] });
    expect(auditScope(owner, { actor: 'x', action: 'file.delete' })).toMatchObject({ action: 'file.delete', actorUid: null, ignored: ['actor'] });
    expect(auditScope(owner, { actor: 'x' })).toMatchObject({ actorUid: 'x', ownOnly: false });
    expect(auditScope(owner, {})).toMatchObject({ actorUid: null, action: null, targetId: null });
  });

  it('bounds the range from now', () => {
    const q = auditListQuery(auditScope(owner, {}), '7d', 'cur', NOW);
    expect(q.from?.toISOString()).toBe('2026-11-06T12:00:00.000Z');
    expect(q).toMatchObject({ cursor: 'cur', limit: 25 });
  });
});

describe('toAuditRowDto', () => {
  const base: AuditEntry = { ...entry({}), id: 'a1', at: new Date(NOW) };

  it('drops file names and keys from file rows written before D-6, and hides an old s_<token> id', () => {
    const row = toAuditRowDto({
      ...base,
      action: 'file.delete',
      targetType: 'share_file',
      targetId: 's_9f1c2b3a4d5e6f708192a3b4c5d6e7f8',
      before: { kind: 'share', name: 'PAYROLL.pdf', size: 10, file_path: 'tok/PAYROLL.pdf', room: null },
    });
    expect(row.before).toEqual({ kind: 'share', size: 10, room: null });
    expect(JSON.stringify(row)).not.toMatch(/PAYROLL|9f1c2b3a/);
  });

  it('keeps other rows as stored', () => {
    const row = toAuditRowDto({ ...base, before: { name: 'Team room' } });
    expect(row.before).toEqual({ name: 'Team room' });
    expect(row.at).toBe('2026-11-13T12:00:00.000Z');
  });
});

describe('listAuditEntries', () => {
  let repo: MemoryAuditRepository;

  beforeEach(async () => {
    repo = new MemoryAuditRepository();
    state.container = { audit: new AuditService(repo) };
    await repo.append(entry({ actorUid: 'owner1', action: 'block.create' }));
    await repo.append(entry({ actorUid: 'mod1', actorRole: 'moderator', action: 'file.delete', targetType: 'share_file', targetId: 'f_x' }));
    await repo.append(entry({ actorUid: 'mod1', actorRole: 'moderator', action: 'block.remove' }));
  });

  it("returns only the moderator's rows, even with ?actor= set to someone else", async () => {
    const params = auditParamsSchema.parse({ actor: 'owner1' });
    const result = await listAuditEntries(mod, params);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.actorUid === 'mod1')).toBe(true);
  });

  it('gives the owner every row, newest first', async () => {
    const result = await listAuditEntries(owner, auditParamsSchema.parse({}));
    if (result.state !== 'ok') throw new Error(result.state);
    expect(result.rows.map((r) => r.action)).toEqual(['block.remove', 'file.delete', 'block.create']);
  });

  it('turns a failed read into an error state with an id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.container = { audit: { list: () => Promise.reject(new Error('down')) } };
    expect(await listAuditEntries(owner, auditParamsSchema.parse({}))).toMatchObject({ state: 'error', errorId: expect.any(String) });
  });
});

describe('audit params and display', () => {
  it('ignores unknown values', () => {
    expect(auditParamsSchema.parse({ range: 'forever', action: 'drop.table', actor: 'a b' })).toEqual({ range: '30d' });
  });

  it('diffs top-level fields and marks unchanged ones', () => {
    expect(diffAudit({ role: 'viewer', email: 'a@x' }, { role: 'moderator', email: 'a@x', note: 1 })).toEqual([
      { field: 'role', before: 'viewer', after: 'moderator', changed: true },
      { field: 'email', before: 'a@x', after: 'a@x', changed: false },
      { field: 'note', before: '—', after: '1', changed: true },
    ]);
    expect(diffAudit(null, null)).toEqual([]);
    expect(formatAuditValue({ a: [1] })).toBe('{"a":[1]}');
    expect(middleTruncate('abcdefghijklmnopqrstuvwxyz0123', 11)).toBe('abcde…z0123');
  });
});
