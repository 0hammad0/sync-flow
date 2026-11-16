import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_WRITE_LIMIT, checkAdminWriteLimit, enforceAdminWriteLimit } from '@/server/auth/admin-write-limit';
import { RateLimitedError, toActionFailure } from '@/server/errors';

// Phase 5.4: 30 admin writes a minute per uid, in memory, per instance.
// The limiter's store is module-level, so each test uses its own uids.

let n = 0;
const uid = () => `uidWriteLimit${++n}`;
const spend = (u: string, times: number) => {
  for (let i = 0; i < times; i++) enforceAdminWriteLimit({ uid: u });
};

describe('enforceAdminWriteLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('allows 30 writes a minute, refuses the 31st with the wait in whole seconds', () => {
    expect(ADMIN_WRITE_LIMIT).toEqual({ max: 30, windowMs: 60_000 });
    const u = uid();
    spend(u, 30);
    vi.advanceTimersByTime(20_500);
    let thrown: unknown;
    try {
      enforceAdminWriteLimit({ uid: u });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RateLimitedError);
    // Oldest write was 20.5 s ago → 39.5 s left → 40 s.
    expect((thrown as RateLimitedError).retryAfterSec).toBe(40);
    expect(toActionFailure(thrown)).toEqual({ ok: false, error: 'rate_limited', retryAfterSec: 40 });
  });

  it('a refused write is not counted, and the window slides open again', () => {
    const u = uid();
    spend(u, 30);
    for (let i = 0; i < 5; i++) expect(checkAdminWriteLimit({ uid: u })).toMatchObject({ allowed: false });
    vi.advanceTimersByTime(59_999);
    expect(checkAdminWriteLimit({ uid: u })).toEqual({ allowed: false, retryAfterSec: 1 });
    vi.advanceTimersByTime(1);
    // All 30 have aged out: a full minute's budget again.
    expect(() => spend(u, 30)).not.toThrow();
    expect(() => enforceAdminWriteLimit({ uid: u })).toThrow(RateLimitedError);
  });

  it('is per admin uid: one admin over the limit does not slow another', () => {
    const a = uid();
    const b = uid();
    spend(a, 30);
    expect(() => enforceAdminWriteLimit({ uid: a })).toThrow(RateLimitedError);
    expect(() => spend(b, 30)).not.toThrow();
    expect(() => enforceAdminWriteLimit({ uid: b })).toThrow(RateLimitedError);
  });

  it('does not share a bucket with the public rate limits (different key prefix)', async () => {
    const { rateLimit } = await import('@/shared/lib/rate-limit');
    const u = uid();
    for (let i = 0; i < 30; i++) rateLimit(u, 30, 60_000);
    expect(() => enforceAdminWriteLimit({ uid: u })).not.toThrow();
  });
});
