import { describe, expect, it, vi } from 'vitest';
import { createSignInAudit, signInAuditId, type SignInAuditDeps } from '@/server/auth/sign-in-audit';
import type { AdminContext } from '@/server/auth/types';
import { AuditService } from '@/server/services/audit-service';
import { MemoryAuditRepository } from '../../../support/memory-audit-repository';

// The default wiring imports the container (Firebase Admin); keep it inert.
vi.mock('@/shared/lib/firebase/admin', () => ({ adminAuth: vi.fn(), adminDb: vi.fn() }));

const CTX: AdminContext = { uid: 'u-owner', email: 'o@example.com', role: 'owner', authTime: 1_700_000_000 };

/** One server instance: its own in-memory set, a shared store, tasks run on flush(). */
function instance(repo: MemoryAuditRepository, overrides: Partial<SignInAuditDeps> = {}) {
  const service = new AuditService(repo);
  const tasks: (() => Promise<void>)[] = [];
  const recordOnce = vi.fn((id: string, input: Parameters<AuditService['recordOnce']>[1]) => service.recordOnce(id, input));
  const record = createSignInAudit({
    recordOnce,
    schedule: (task) => tasks.push(task),
    readRequestMeta: async () => ({ ip: '203.0.113.7', userAgent: 'test-agent' }),
    logger: { error: vi.fn() },
    ...overrides,
  });
  const flush = async () => {
    for (const task of tasks.splice(0)) await task();
  };
  return { record, recordOnce, tasks, flush };
}

async function signInRows(repo: MemoryAuditRepository) {
  return (await repo.list({ limit: 100, action: 'auth.sign_in' })).entries;
}

describe('recordSignInOnce', () => {
  it('writes one auth.sign_in row after the response, with actor and request info', async () => {
    const repo = new MemoryAuditRepository();
    const a = instance(repo);

    a.record(CTX);
    // Nothing is written during render; the task waits for after().
    expect(await signInRows(repo)).toHaveLength(0);
    expect(a.tasks).toHaveLength(1);

    await a.flush();
    const rows = await signInRows(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: signInAuditId(CTX.uid, CTX.authTime),
      action: 'auth.sign_in',
      actorUid: 'u-owner',
      actorEmail: 'o@example.com',
      actorRole: 'owner',
      after: { authTime: CTX.authTime },
      ip: '203.0.113.7',
      userAgent: 'test-agent',
    });
  });

  it('does not write again for the same session on the same instance (no store call at all)', async () => {
    const repo = new MemoryAuditRepository();
    const a = instance(repo);

    a.record(CTX);
    await a.flush();
    a.record(CTX);
    a.record({ ...CTX, role: 'viewer' });
    expect(a.tasks).toHaveLength(0);
    await a.flush();

    expect(a.recordOnce).toHaveBeenCalledTimes(1);
    expect(await signInRows(repo)).toHaveLength(1);
  });

  it('schedules once when two renders race before the write finishes', async () => {
    const repo = new MemoryAuditRepository();
    const a = instance(repo);
    a.record(CTX);
    a.record(CTX);
    expect(a.tasks).toHaveLength(1);
  });

  it('writes again for a new sign-in (different auth_time) and for another admin', async () => {
    const repo = new MemoryAuditRepository();
    const a = instance(repo);

    a.record(CTX);
    a.record({ ...CTX, authTime: CTX.authTime + 3600 });
    a.record({ ...CTX, uid: 'u-mod', email: 'm@example.com', role: 'moderator' });
    await a.flush();

    expect((await signInRows(repo)).map((r) => r.id).sort()).toEqual(
      [
        signInAuditId('u-owner', CTX.authTime),
        signInAuditId('u-owner', CTX.authTime + 3600),
        signInAuditId('u-mod', CTX.authTime),
      ].sort(),
    );
  });

  it('a second server instance adds no duplicate row (fixed id, create-once)', async () => {
    const repo = new MemoryAuditRepository();
    const a = instance(repo);
    const b = instance(repo);

    a.record(CTX);
    b.record(CTX);
    await a.flush();
    await b.flush();

    expect(b.recordOnce).toHaveBeenCalledTimes(1);
    await expect(b.recordOnce.mock.results[0].value).resolves.toBe(false);
    expect(await signInRows(repo)).toHaveLength(1);
  });

  it('never throws into the page, and retries on a later load when the write failed', async () => {
    const repo = new MemoryAuditRepository();
    const logger = { error: vi.fn() };
    let fail = true;
    const service = new AuditService(repo);
    const a = instance(repo, {
      logger,
      recordOnce: async (id, input) => {
        if (fail) throw new Error('UNAVAILABLE');
        return service.recordOnce(id, input);
      },
    });

    a.record(CTX);
    await expect(a.flush()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(await signInRows(repo)).toHaveLength(0);

    fail = false;
    a.record(CTX);
    await a.flush();
    expect(await signInRows(repo)).toHaveLength(1);
  });

  it('does not fail the page when scheduling throws', () => {
    const logger = { error: vi.fn() };
    const a = instance(new MemoryAuditRepository(), {
      logger,
      schedule: () => {
        throw new Error('after() outside a request');
      },
    });
    expect(() => a.record(CTX)).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('still writes the row when the request headers cannot be read', async () => {
    const repo = new MemoryAuditRepository();
    const a = instance(repo, { readRequestMeta: async () => Promise.reject(new Error('no request')) });
    a.record(CTX);
    await a.flush();
    expect((await signInRows(repo))[0]).toMatchObject({ ip: null, userAgent: null });
  });

  it('keeps memory bounded; a forgotten session costs one refused write, not a duplicate', async () => {
    const repo = new MemoryAuditRepository();
    const a = instance(repo, { maxKeys: 2 });

    a.record(CTX);
    a.record({ ...CTX, uid: 'u2' });
    a.record({ ...CTX, uid: 'u3' }); // forgets the oldest (CTX)
    await a.flush();
    a.record(CTX);
    await a.flush();

    expect(a.recordOnce).toHaveBeenCalledTimes(4);
    expect(await signInRows(repo)).toHaveLength(3);
  });

  it('builds a Firestore-safe id', () => {
    expect(signInAuditId('abc', 1_700_000_000)).toBe('signin_abc_1700000000');
    expect(signInAuditId('a/b', 1)).not.toContain('/');
  });
});
