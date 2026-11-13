import { beforeEach, describe, expect, it } from 'vitest';

import type { AdminContext } from '@/server/auth/types';
import type { AuditRepository, NewAuditEntry } from '@/server/repositories/interfaces';
import {
  AUDIT_DATA_MAX_BYTES,
  AuditService,
  DENIED_WINDOW_MS,
  sanitizeAuditData,
} from '@/server/services/audit-service';
import { MemoryAuditRepository } from '../../../support/memory-audit-repository';

const owner: AdminContext = { uid: 'uid-owner', email: 'owner@example.com', role: 'owner', authTime: 1_763_000_000 };

describe('AuditService.record', () => {
  let clock: number;
  let repo: MemoryAuditRepository;
  let service: AuditService;

  beforeEach(() => {
    clock = Date.UTC(2026, 10, 13, 12);
    repo = new MemoryAuditRepository(() => clock);
    service = new AuditService(repo, { now: () => clock, logger: { error: () => {} } });
  });

  it('writes one row with the actor from the context', async () => {
    const id = await service.record({
      ctx: owner,
      action: 'block.create',
      target: { type: 'ip', id: '203.0.113.7' },
      before: null,
      after: { type: 'ip', expires_at: new Date(Date.UTC(2026, 10, 14)) },
      reason: '  Spam uploads  ',
      request: { ip: '198.51.100.1', userAgent: 'Chrome' },
    });

    const { entries } = await repo.list({ limit: 10 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      id,
      at: new Date(clock),
      actorUid: 'uid-owner',
      actorEmail: 'owner@example.com',
      actorRole: 'owner',
      action: 'block.create',
      targetType: 'ip',
      targetId: '203.0.113.7',
      before: null,
      after: { type: 'ip', expires_at: '2026-11-14T00:00:00.000Z' },
      reason: 'Spam uploads',
      ip: '198.51.100.1',
      userAgent: 'Chrome',
    });
  });

  it('stores nulls for missing optional parts', async () => {
    await service.record({ ctx: { ...owner, email: null }, action: 'auth.sign_in' });
    const [row] = (await repo.list({ limit: 1 })).entries;
    expect(row).toMatchObject({
      actorEmail: null,
      targetType: null,
      targetId: null,
      before: null,
      after: null,
      reason: null,
      ip: null,
      userAgent: null,
    });
  });

  it('fails when the audit write fails, so the action fails too', async () => {
    const failing: AuditRepository = {
      append: async () => {
        throw new Error('write failed');
      },
      appendOnce: async () => {
        throw new Error('write failed');
      },
      list: async () => ({ entries: [], nextCursor: null }),
    };
    const s = new AuditService(failing);
    await expect(s.record({ ctx: owner, action: 'file.delete' })).rejects.toThrow('write failed');
    await expect(s.recordOnce('x', { ctx: owner, action: 'auth.sign_in' })).rejects.toThrow('write failed');
  });

  it('recordOnce writes a cleaned row under the id once', async () => {
    const repo = new MemoryAuditRepository();
    const s = new AuditService(repo);
    const input = { ctx: owner, action: 'auth.sign_in' as const, after: { authTime: 1, idToken: 'secret' }, request: { ip: ' 203.0.113.7 ' } };
    expect(await s.recordOnce('signin_x_1', input)).toBe(true);
    expect(await s.recordOnce('signin_x_1', input)).toBe(false);
    const { entries } = await repo.list({ limit: 10 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'signin_x_1', action: 'auth.sign_in', after: { authTime: 1 }, ip: '203.0.113.7' });
    expect(entries[0].after).not.toHaveProperty('idToken');
  });

  it('never stores message text, tokens, cookies or URLs in before/after', async () => {
    await service.record({
      ctx: owner,
      action: 'room.close',
      target: { type: 'room', id: 'ABCD1234' },
      before: {
        code: 'ABCD1234',
        text: 'hello secret message',
        lastMessage: 'hi',
        messages: ['a', 'b'],
        content: 'file bytes',
        contentType: 'image/png',
        messageCount: 3,
        idToken: 'eyJ...',
        session_cookie: 'abc',
        signedUrl: 'https://r2.example/x?sig=1',
        downloadURLs: ['https://x'],
        password: 'hunter2',
        nested: { body: '{...}', size: 10, deeper: [{ token: 't', name: 'ok' }] },
      },
    });
    const [row] = (await repo.list({ limit: 1 })).entries;
    expect(row.before).toEqual({
      code: 'ABCD1234',
      contentType: 'image/png',
      messageCount: 3,
      nested: { size: 10, deeper: [{ name: 'ok' }] },
    });
  });
});

describe('sanitizeAuditData', () => {
  it('returns null for null or undefined', () => {
    expect(sanitizeAuditData(null)).toBeNull();
    expect(sanitizeAuditData(undefined)).toBeNull();
  });

  it('drops values Firestore cannot store and turns dates into ISO strings', () => {
    const ts = { toDate: () => new Date(Date.UTC(2026, 0, 1)) };
    expect(
      sanitizeAuditData({
        a: undefined,
        b: () => 1,
        c: Number.NaN,
        d: Number.POSITIVE_INFINITY,
        e: 1,
        f: ts,
        g: [1, undefined, 'x'],
        h: new Date('invalid'),
      }),
    ).toEqual({ e: 1, f: '2026-01-01T00:00:00.000Z', g: [1, 'x'] });
  });

  it('caps each field at 8 KB and marks it truncated', () => {
    const big = 'x'.repeat(3_000);
    const out = sanitizeAuditData({ a: big, b: big, c: big, d: 'small' });
    expect(out).not.toBeNull();
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThanOrEqual(AUDIT_DATA_MAX_BYTES);
    expect(out).toEqual({ _truncated: true, a: big, b: big, d: 'small' });
  });

  it('leaves small data untouched', () => {
    const data = { role: 'moderator', count: 2, enabled: true, none: null, list: ['a'] };
    expect(sanitizeAuditData(data)).toEqual(data);
  });
});

describe('AuditService.recordDenied', () => {
  let clock: number;
  let appended: NewAuditEntry[];
  let service: AuditService;

  beforeEach(() => {
    clock = Date.UTC(2026, 10, 13, 12);
    appended = [];
    const repo: AuditRepository = {
      append: async (entry) => {
        appended.push(entry);
        return `id-${appended.length}`;
      },
      appendOnce: async () => true,
      list: async () => ({ entries: [], nextCursor: null }),
    };
    service = new AuditService(repo, { now: () => clock, logger: { error: () => {} } });
  });

  it('writes auth.denied with no role', async () => {
    const id = await service.recordDenied({
      uid: 'uid-x',
      email: 'x@example.com',
      target: { type: 'path', id: '/admin/files' },
      reason: 'no_role',
      request: { ip: '198.51.100.9', userAgent: 'Firefox' },
    });
    expect(id).toBe('id-1');
    expect(appended[0]).toEqual({
      actorUid: 'uid-x',
      actorEmail: 'x@example.com',
      actorRole: null,
      action: 'auth.denied',
      targetType: 'path',
      targetId: '/admin/files',
      before: null,
      after: null,
      reason: 'no_role',
      ip: '198.51.100.9',
      userAgent: 'Firefox',
    });
  });

  it('writes at most one row per uid per 10 minutes', async () => {
    expect(await service.recordDenied({ uid: 'u1', email: null })).not.toBeNull();
    expect(await service.recordDenied({ uid: 'u1', email: null })).toBeNull();
    expect(await service.recordDenied({ uid: 'u2', email: null })).not.toBeNull();
    clock += DENIED_WINDOW_MS - 1;
    expect(await service.recordDenied({ uid: 'u1', email: null })).toBeNull();
    clock += 1;
    expect(await service.recordDenied({ uid: 'u1', email: null })).not.toBeNull();
    expect(appended).toHaveLength(3);
  });

  it('rate limits by IP when there is no uid', async () => {
    const req = { request: { ip: '198.51.100.9' } };
    expect(await service.recordDenied({ uid: null, email: null, ...req })).not.toBeNull();
    expect(await service.recordDenied({ uid: null, email: null, ...req })).toBeNull();
    expect(await service.recordDenied({ uid: null, email: null, request: { ip: '198.51.100.10' } })).not.toBeNull();
  });

  it('never throws when the write fails', async () => {
    const s = new AuditService(
      {
        append: async () => {
          throw new Error('down');
        },
        appendOnce: async () => true,
        list: async () => ({ entries: [], nextCursor: null }),
      },
      { logger: { error: () => {} } },
    );
    await expect(s.recordDenied({ uid: 'u', email: null })).resolves.toBeNull();
  });
});
