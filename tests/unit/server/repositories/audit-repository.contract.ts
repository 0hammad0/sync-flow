import { beforeEach, describe, expect, it } from 'vitest';

import type { AuditRepository, NewAuditEntry } from '@/server/repositories/interfaces';

/**
 * One behaviour for every AuditRepository (Liskov). Runs on the in-memory
 * repo in `unit` and on Firestore (emulator) in `integration`.
 * `makeRepo` must return an empty repository.
 */
export function runAuditRepositoryContract(name: string, makeRepo: () => Promise<AuditRepository>) {
  describe(`AuditRepository contract: ${name}`, () => {
    let repo: AuditRepository;

    beforeEach(async () => {
      repo = await makeRepo();
    });

    function entry(overrides: Partial<NewAuditEntry> = {}): NewAuditEntry {
      return {
        actorUid: 'uid-owner',
        actorEmail: 'owner@example.com',
        actorRole: 'owner',
        action: 'block.create',
        targetType: 'ip',
        targetId: '203.0.113.7',
        before: null,
        after: { type: 'ip', expires_at: '2026-11-14T00:00:00.000Z', nested: { count: 2, tags: ['a', 'b'] } },
        reason: 'Spam uploads',
        ip: '198.51.100.1',
        userAgent: 'Vitest',
        ...overrides,
      };
    }

    async function appendInOrder(entries: NewAuditEntry[]): Promise<string[]> {
      const ids: string[] = [];
      for (const e of entries) ids.push(await repo.append(e));
      return ids;
    }

    async function listAll(query: { limit: number; actorUid?: string }): Promise<string[]> {
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page += 1) {
        const result = await repo.list({ ...query, cursor });
        expect(result.entries.length).toBeLessThanOrEqual(query.limit);
        ids.push(...result.entries.map((e) => e.id));
        if (!result.nextCursor) return ids;
        cursor = result.nextCursor;
      }
      throw new Error('paging did not finish');
    }

    it('has no update or delete method (append only)', () => {
      for (const method of ['update', 'delete', 'remove', 'set', 'put', 'upsert', 'clear', 'destroy']) {
        expect(Reflect.get(repo, method), method).toBeUndefined();
      }
    });

    it('appends a row and lists it back with every field', async () => {
      const before = Date.now();
      const id = await repo.append(entry({ before: { role: null } }));
      expect(id).toEqual(expect.any(String));
      expect(id.length).toBeGreaterThan(0);

      const { entries, nextCursor } = await repo.list({ limit: 10 });
      expect(nextCursor).toBeNull();
      expect(entries).toHaveLength(1);
      const [row] = entries;
      expect(row).toMatchObject({ ...entry({ before: { role: null } }), id });
      expect(row.at).toBeInstanceOf(Date);
      // Server clock vs test clock: allow a generous skew.
      expect(Math.abs(row.at.getTime() - before)).toBeLessThan(60_000);
    });

    it('stores nulls as nulls', async () => {
      const id = await repo.append(
        entry({ actorUid: null, actorEmail: null, actorRole: null, targetType: null, targetId: null, after: null, reason: null, ip: null, userAgent: null }),
      );
      const { entries } = await repo.list({ limit: 1 });
      expect(entries[0]).toMatchObject({
        id,
        actorUid: null,
        actorEmail: null,
        actorRole: null,
        targetType: null,
        targetId: null,
        before: null,
        after: null,
        reason: null,
        ip: null,
        userAgent: null,
      });
    });

    it('lists newest first', async () => {
      const ids = await appendInOrder([entry(), entry(), entry()]);
      const { entries } = await repo.list({ limit: 10 });
      expect(entries.map((e) => e.id)).toEqual([...ids].reverse());
    });

    it('pages with a cursor without gaps or repeats', async () => {
      const ids = await appendInOrder([entry(), entry(), entry(), entry(), entry()]);
      expect(await listAll({ limit: 2 })).toEqual([...ids].reverse());
      // Exact multiple of the page size: the last page is empty, no repeats.
      expect(await listAll({ limit: 5 })).toEqual([...ids].reverse());
    });

    it('returns no cursor on a short page', async () => {
      await appendInOrder([entry(), entry()]);
      const page = await repo.list({ limit: 3 });
      expect(page.entries).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('filters by actor, action, target, and actor + action', async () => {
      const [a, b, c, d] = await appendInOrder([
        entry({ actorUid: 'u1', action: 'block.create', targetId: 't1' }),
        entry({ actorUid: 'u1', action: 'file.delete', targetId: 't2' }),
        entry({ actorUid: 'u2', action: 'file.delete', targetId: 't1' }),
        entry({ actorUid: 'u2', action: 'room.close', targetId: 't3' }),
      ]);
      const ids = async (q: Parameters<AuditRepository['list']>[0]) => (await repo.list(q)).entries.map((e) => e.id);

      expect(await ids({ limit: 10, actorUid: 'u1' })).toEqual([b, a]);
      expect(await ids({ limit: 10, action: 'file.delete' })).toEqual([c, b]);
      expect(await ids({ limit: 10, targetId: 't1' })).toEqual([c, a]);
      expect(await ids({ limit: 10, actorUid: 'u2', action: 'room.close' })).toEqual([d]);
      expect(await ids({ limit: 10, actorUid: 'nobody' })).toEqual([]);
      expect(await listAll({ limit: 1, actorUid: 'u2' })).toEqual([d, c]);
    });

    it('filters by time range (from inclusive, to exclusive)', async () => {
      const ids = await appendInOrder([entry(), entry()]);
      const hour = 3_600_000;
      const now = Date.now();
      const list = async (from?: Date, to?: Date) =>
        (await repo.list({ limit: 10, from, to })).entries.map((e) => e.id);

      expect(await list(new Date(now - hour), new Date(now + hour))).toEqual([...ids].reverse());
      expect(await list(new Date(now + hour))).toEqual([]);
      expect(await list(undefined, new Date(now - hour))).toEqual([]);
    });

    it('does not let callers change stored rows through returned objects', async () => {
      await repo.append(entry());
      const first = await repo.list({ limit: 1 });
      first.entries[0].reason = 'changed';
      (first.entries[0].after as Record<string, unknown>).type = 'changed';
      const second = await repo.list({ limit: 1 });
      expect(second.entries[0].reason).toBe('Spam uploads');
      expect(second.entries[0].after).toMatchObject({ type: 'ip' });
    });
  });
}
