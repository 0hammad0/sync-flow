import { describe, expect, it } from 'vitest';
import { authAgeSec, checkRecentAuth, requireRecentAuth, STEP_UP_MAX_AGE_SEC } from '@/server/auth/step-up';
import { StepUpRequiredError } from '@/server/errors';

const NOW_MS = 1_800_000_000_000;
const nowSec = NOW_MS / 1000;

describe('step-up', () => {
  it('window is 15 minutes', () => {
    expect(STEP_UP_MAX_AGE_SEC).toBe(900);
  });

  it('fresh authTime passes', () => {
    expect(() => requireRecentAuth({ authTime: nowSec - 60 }, undefined, NOW_MS)).not.toThrow();
    expect(checkRecentAuth({ authTime: nowSec - 60 }, undefined, NOW_MS)).toEqual({ ok: true, data: undefined });
  });

  it('exactly 900 s passes, 901 s needs step-up', () => {
    expect(() => requireRecentAuth({ authTime: nowSec - 900 }, undefined, NOW_MS)).not.toThrow();
    expect(() => requireRecentAuth({ authTime: nowSec - 901 }, undefined, NOW_MS)).toThrow(StepUpRequiredError);
  });

  it('stale authTime throws StepUpRequiredError with the age', () => {
    try {
      requireRecentAuth({ authTime: nowSec - 2 * 3600 }, undefined, NOW_MS);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(StepUpRequiredError);
      expect((e as StepUpRequiredError).authAgeSec).toBe(7200);
      expect((e as StepUpRequiredError).code).toBe('step_up_required');
    }
  });

  it('checkRecentAuth returns an error result instead of throwing', () => {
    const result = checkRecentAuth({ authTime: nowSec - 1000 }, undefined, NOW_MS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.authAgeSec).toBe(1000);
  });

  it('honours a custom max age', () => {
    expect(checkRecentAuth({ authTime: nowSec - 120 }, 60, NOW_MS).ok).toBe(false);
  });

  it('a slightly future authTime (clock skew) counts as fresh', () => {
    expect(authAgeSec({ authTime: nowSec + 5 }, NOW_MS)).toBe(0);
    expect(() => requireRecentAuth({ authTime: nowSec + 5 }, undefined, NOW_MS)).not.toThrow();
  });

  it('missing or broken authTime always needs step-up', () => {
    for (const authTime of [0, -1, Number.NaN]) {
      expect(() => requireRecentAuth({ authTime }, undefined, NOW_MS)).toThrow(StepUpRequiredError);
    }
  });

  it('uses the real clock by default', () => {
    expect(() => requireRecentAuth({ authTime: Math.floor(Date.now() / 1000) })).not.toThrow();
  });
});
