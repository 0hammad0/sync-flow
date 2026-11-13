import { beforeEach, describe, expect, it } from 'vitest';

import type { BlockRecord, BlockRepository, NewAuditEntry, NewBlock } from '@/server/repositories/interfaces';

const NOW = new Date('2026-11-13T14:02:00.000Z');
const HOUR = 3_600_000;

function auditFor(action: 'block.create' | 'block.remove', block: BlockRecord): NewAuditEntry {
  return {
    actorUid: 'uid-owner',
    actorEmail: 'owner@example.com',
    actorRole: 'owner',
    action,
    targetType: `block_${block.type}`,
    targetId: block.id,
    before: null,
    after: { value: block.value },
    reason: block.reason,
    ip: null,
    userAgent: null,
  };
}

function newBlock(overrides: Partial<NewBlock> = {}): NewBlock {
  return {
    type: 'ip',
    value: '203.0.113.7',
    reason: 'Spam uploads',
    createdBy: 'uid-owner',
    createdByEmail: 'owner@example.com',
    expiresAt: new Date(NOW.getTime() + 24 * HOUR),
    ...overrides,
  };
}

/**
 * One behaviour for every BlockRepository. Runs on the in-memory repo in
 * `unit` and on Firestore (emulator) in `integration`. `makeRepo` returns an
 * empty repository; `auditRows` reads back the audit rows it wrote.
 */
export function runBlockRepositoryContract(
  name: string,
  makeRepo: () => Promise<{ repo: BlockRepository; auditRows: () => Promise<NewAuditEntry[]> }>,
) {
  describe(`BlockRepository contract: ${name}`, () => {
    let repo: BlockRepository;
    let auditRows: () => Promise<NewAuditEntry[]>;

    beforeEach(async () => {
      ({ repo, auditRows } = await makeRepo());
    });

    async function create(overrides: Partial<NewBlock> = {}, at = NOW) {
      const result = await repo.create(newBlock(overrides), (b) => auditFor('block.create', b), at);
      if (!result.ok) throw new Error('create failed');
      return result.block;
    }

    it('create writes the block, the enforcement copy and one audit row', async () => {
      const block = await create();
      expect(block).toMatchObject({ type: 'ip', value: '203.0.113.7', reason: 'Spam uploads', removedAt: null, hits: 0 });
      expect(block.id).toMatch(/^[A-Z0-9]{6}/);
      expect(await repo.get(block.id)).toEqual(block);

      const { blocklist } = await repo.readBlocklist();
      expect(blocklist.ips).toEqual([{ id: block.id, value: '203.0.113.7', expiresAt: block.expiresAt!.getTime() }]);
      expect(blocklist.version).toBe(1);

      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: 'block.create', targetId: block.id, reason: 'Spam uploads' });
    });

    it('refuses a duplicate live block and writes nothing', async () => {
      const first = await create();
      const again = await repo.create(newBlock(), (b) => auditFor('block.create', b), NOW);
      expect(again).toEqual({ ok: false, reason: 'duplicate', existing: { id: first.id, expiresAt: first.expiresAt } });
      expect((await repo.readBlocklist()).blocklist.version).toBe(1);
      expect(await auditRows()).toHaveLength(1);
    });

    it('allows a new block once the old one has expired', async () => {
      await create({ expiresAt: new Date(NOW.getTime() + HOUR) });
      const later = new Date(NOW.getTime() + 2 * HOUR);
      const second = await create({}, later);
      const { blocklist } = await repo.readBlocklist();
      expect(blocklist.ips.map((e) => e.id)).toEqual([second.id]);
    });

    it('remove marks the block, drops it from the enforcement copy and writes one audit row', async () => {
      const block = await create();
      const result = await repo.remove(block.id, 'uid-mod', (_before, after) => auditFor('block.remove', after), NOW);
      expect(result.ok && result.block.removedBy).toBe('uid-mod');
      expect((await repo.get(block.id))?.removedAt?.getTime()).toBe(NOW.getTime());
      const { blocklist } = await repo.readBlocklist();
      expect(blocklist.ips).toEqual([]);
      expect(blocklist.version).toBe(2);
      expect((await auditRows()).map((r) => r.action)).toEqual(['block.create', 'block.remove']);
    });

    it('a second remove is refused without a second audit row', async () => {
      const block = await create();
      await repo.remove(block.id, 'a', (_b, after) => auditFor('block.remove', after), NOW);
      const again = await repo.remove(block.id, 'b', (_b, after) => auditFor('block.remove', after), NOW);
      expect(again).toEqual({ ok: false, reason: 'already_removed' });
      expect(await auditRows()).toHaveLength(2);
      expect(await repo.remove('NOPE00000000000000000', 'a', (_b, after) => auditFor('block.remove', after), NOW)).toEqual({
        ok: false,
        reason: 'not_found',
      });
    });

    it('lists by status and type, with counts', async () => {
      const active = await create({ value: '203.0.113.1' });
      const never = await create({ value: '203.0.113.2', expiresAt: null });
      const country = await create({ type: 'country', value: 'KP' });
      const expired = await create({ value: '203.0.113.3', expiresAt: new Date(NOW.getTime() - HOUR) }, new Date(NOW.getTime() - 2 * HOUR));
      const removed = await create({ value: '203.0.113.4' });
      await repo.remove(removed.id, 'a', (_b, after) => auditFor('block.remove', after), NOW);

      const ids = async (status: 'active' | 'expired' | 'removed', type?: 'ip' | 'country') =>
        (await repo.list({ status, type, limit: 25, now: NOW })).blocks.map((b) => b.id);
      // Active: ending soonest first, "never" last.
      expect(await ids('active')).toEqual([active.id, country.id, never.id]);
      expect(await ids('active', 'country')).toEqual([country.id]);
      expect(await ids('expired')).toEqual([expired.id]);
      expect(await ids('removed')).toEqual([removed.id]);
      expect(await repo.count('active', NOW)).toBe(3);
      expect(await repo.count('active', NOW, 'ip')).toBe(2);
      expect(await repo.count('expired', NOW)).toBe(1);
      expect(await repo.count('removed', NOW)).toBe(1);
    });

    it('pages with a cursor and never repeats a row', async () => {
      for (let i = 0; i < 5; i += 1) await create({ value: `198.51.100.${i}`, expiresAt: new Date(NOW.getTime() + (i + 1) * HOUR) });
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const result: Awaited<ReturnType<BlockRepository['list']>> = await repo.list({ status: 'active', limit: 2, cursor, now: NOW });
        seen.push(...result.blocks.map((b) => b.value));
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      expect(seen).toEqual(['198.51.100.0', '198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4']);
    });

    it('searches by exact value and by support ref', async () => {
      const block = await create({ value: '203.0.113.9' });
      expect((await repo.list({ status: 'active', q: '203.0.113.9', limit: 25, now: NOW })).blocks.map((b) => b.id)).toEqual([block.id]);
      const ref = `${block.id.slice(0, 6)}-2611131402`;
      expect((await repo.list({ status: 'active', q: ref, limit: 25, now: NOW })).blocks.map((b) => b.id)).toEqual([block.id]);
      expect((await repo.list({ status: 'removed', q: '203.0.113.9', limit: 25, now: NOW })).blocks).toEqual([]);
    });

    it('sweepExpired drops only expired entries and bumps the version once', async () => {
      const keep = await create({ value: '203.0.113.1', expiresAt: null });
      await create({ value: '203.0.113.2', expiresAt: new Date(NOW.getTime() + HOUR) });
      const later = new Date(NOW.getTime() + 2 * HOUR);
      expect(await repo.sweepExpired(later)).toBe(1);
      const { blocklist } = await repo.readBlocklist();
      expect(blocklist.ips.map((e) => e.id)).toEqual([keep.id]);
      expect(blocklist.version).toBe(3);
      expect(await repo.sweepExpired(later)).toBe(0);
      expect((await repo.readBlocklist()).blocklist.version).toBe(3);
    });

    it('addHits adds to the hit counter', async () => {
      const block = await create();
      await repo.addHits(new Map([[block.id, 3]]));
      await repo.addHits(new Map([[block.id, 2]]));
      expect((await repo.get(block.id))?.hits).toBe(5);
    });
  });
}
