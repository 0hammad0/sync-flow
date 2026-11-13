import { beforeEach, describe, expect, it } from 'vitest';

import type { AdminContext } from '@/server/auth/types';
import { StepUpRequiredError, ValidationError } from '@/server/errors';
import { BlockService, type BlockActor, type BlockUserLookup, type CreateBlockInput } from '@/server/services/block-service';
import { MemoryBlockRepository } from '../../../support/memory-block-repository';

const NOW = Date.UTC(2026, 10, 13, 14, 2);
const ctx: AdminContext = { uid: 'uid-mod', email: 'mod@example.com', role: 'moderator', authTime: NOW / 1000 - 60 };
const actor: BlockActor = { ip: '198.51.100.9', country: 'PK', userAgent: 'Vitest' };

const users: BlockUserLookup = {
  async find(q) {
    if (q === 'sara@example.com' || q === 'uid-sara') return { uid: 'uid-sara', role: null };
    if (q === 'uid-owner') return { uid: 'uid-owner', role: 'owner' };
    return null;
  },
};

function input(overrides: Partial<CreateBlockInput> = {}): CreateBlockInput {
  return { ctx, type: 'ip', value: '203.0.113.7', reason: 'Spam uploads', duration: '24h', acknowledged: false, actor, ...overrides };
}

function fieldError(result: { ok: boolean; error?: unknown }, field: string): string | undefined {
  if (result.ok) return undefined;
  const e = result.error as ValidationError;
  expect(e).toBeInstanceOf(ValidationError);
  return e.fields[field]?.[0];
}

describe('BlockService.create', () => {
  let repo: MemoryBlockRepository;
  let service: BlockService;

  beforeEach(() => {
    repo = new MemoryBlockRepository();
    service = new BlockService(repo, users, { now: () => NOW });
  });

  it('normalises, stores with expiry and writes one block.create audit row', async () => {
    const result = await service.create(input({ value: ' 2001:DB8::0001 ' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.value).toBe('2001:db8::1');
    expect(result.data.expiresAt?.getTime()).toBe(NOW + 86_400_000);
    expect(repo.audit).toHaveLength(1);
    expect(repo.audit[0]).toMatchObject({
      action: 'block.create',
      actorUid: 'uid-mod',
      actorRole: 'moderator',
      targetId: result.data.id,
      reason: 'Spam uploads',
      before: null,
      after: { type: 'ip', value: '2001:db8::1', reason: 'Spam uploads' },
      ip: '198.51.100.9',
    });
  });

  it('rejects bad values and short reasons with field messages', async () => {
    expect(fieldError(await service.create(input({ value: '1.2.3' })), 'value')).toBe('Enter a valid IPv4 or IPv6 address.');
    expect(fieldError(await service.create(input({ value: 'fe80::1%eth0' })), 'value')).toBe('Zone ids are not allowed.');
    expect(fieldError(await service.create(input({ type: 'cidr', value: '10.0.0.0/7' })), 'value')).toBe(
      'This range is too wide to block.',
    );
    expect(fieldError(await service.create(input({ type: 'country', value: 'QQ' })), 'value')).toBe('Pick a country from the list.');
    expect(fieldError(await service.create(input({ reason: ' a ' })), 'reason')).toMatch(/at least 3/);
    expect(repo.audit).toHaveLength(0);
  });

  it('hard stops: own IP, range with own IP, own country, own uid, an owner', async () => {
    expect(fieldError(await service.create(input({ value: '198.51.100.9' })), 'value')).toMatch(/your current IP/);
    expect(fieldError(await service.create(input({ type: 'cidr', value: '198.51.100.0/24' })), 'value')).toMatch(/your current IP/);
    expect(fieldError(await service.create(input({ type: 'country', value: 'pk', confirm: 'PK' })), 'value')).toBe(
      'You are in Pakistan. Blocking it would lock you out.',
    );
    expect(fieldError(await service.create(input({ type: 'uid', value: 'uid-mod' })), 'value')).toBe('No user with that email or uid.');
    expect(fieldError(await service.create(input({ type: 'uid', value: 'uid-owner' })), 'value')).toMatch(/Owners cannot be blocked/);
    expect(repo.audit).toHaveLength(0);
  });

  it('resolves an email to a uid', async () => {
    const result = await service.create(input({ type: 'uid', value: 'Sara@Example.com' }));
    expect(result.ok && result.data.value).toBe('uid-sara');
  });

  it('warnings need "I understand"', async () => {
    expect(fieldError(await service.create(input({ value: '100.64.1.1' })), 'acknowledged')).toMatch(/carrier NAT/);
    expect((await service.create(input({ value: '100.64.1.1', acknowledged: true }))).ok).toBe(true);
  });

  it('country and wide ranges need a recent sign-in and type-to-confirm', async () => {
    const old = { ...ctx, authTime: NOW / 1000 - 3600 };
    const stale = await service.create(input({ ctx: old, type: 'country', value: 'KP', confirm: 'KP' }));
    expect(!stale.ok && stale.error).toBeInstanceOf(StepUpRequiredError);
    expect(fieldError(await service.create(input({ type: 'country', value: 'KP' })), 'confirm')).toBe('Type KP to confirm.');
    expect((await service.create(input({ type: 'country', value: 'KP', confirm: 'kp' }))).ok).toBe(true);
    const wide = await service.create(input({ type: 'cidr', value: '185.220.0.0/15', acknowledged: true, confirm: '185.220.0.0/15' }));
    expect(wide.ok).toBe(true);
  });

  it('refuses a duplicate with the existing end time', async () => {
    await service.create(input());
    expect(fieldError(await service.create(input()), 'value')).toBe('This is already blocked until 14 Nov, 14:02 UTC.');
  });
});

describe('BlockService.remove', () => {
  it('removes once, with one block.remove row; a second remove is a conflict and writes nothing', async () => {
    const repo = new MemoryBlockRepository();
    const service = new BlockService(repo, users, { now: () => NOW });
    const created = await service.create(input());
    if (!created.ok) throw new Error('setup');

    const first = await service.remove({ ctx, id: created.data.id, actor });
    expect(first.ok).toBe(true);
    expect(repo.audit.map((r) => r.action)).toEqual(['block.create', 'block.remove']);
    expect(repo.audit[1]).toMatchObject({ before: { removed_at: null }, after: { removed_at: new Date(NOW).toISOString() } });

    const second = await service.remove({ ctx, id: created.data.id, actor });
    expect(!second.ok && second.error.code).toBe('conflict');
    expect(repo.audit).toHaveLength(2);

    const missing = await service.remove({ ctx, id: 'missing', actor });
    expect(!missing.ok && missing.error.code).toBe('not_found');
  });

  it('a failed write leaves no audit row (all or nothing)', async () => {
    const repo = new MemoryBlockRepository();
    const service = new BlockService(repo, users, { now: () => NOW });
    repo.failNextWrite = true;
    await expect(service.create(input())).rejects.toThrow('write failed');
    expect(repo.audit).toHaveLength(0);
    expect(repo.blocklist.version).toBe(0);
  });
});

describe('BlockService.list and sweep', () => {
  it('normalises the search value and counts per tab', async () => {
    const repo = new MemoryBlockRepository();
    const service = new BlockService(repo, users, { now: () => NOW });
    await service.create(input({ value: '2001:db8::1' }));
    const page = await service.list({ status: 'active', q: '2001:DB8:0::1', limit: 25 });
    expect(page.blocks).toHaveLength(1);
    expect(await service.counts()).toEqual({ active: 1, expired: 0, removed: 0 });
  });

  it('sweepExpired never throws', async () => {
    const repo = new MemoryBlockRepository();
    repo.sweepExpired = async () => {
      throw new Error('down');
    };
    const service = new BlockService(repo, users, { now: () => NOW });
    const original = console.error;
    console.error = () => {};
    try {
      expect(await service.sweepExpired()).toEqual({ error: 'sweep_failed' });
    } finally {
      console.error = original;
    }
  });
});
