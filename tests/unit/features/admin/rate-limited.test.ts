import { beforeEach, describe, expect, it, vi } from 'vitest';

// Client side of the admin write limit (5.4): `rate_limited` → toast with the wait.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { RATE_LIMITED_TITLE, rateLimitedMessage, rateLimitedNotice } = await import('@/features/admin/rate-limited');

describe('rate-limited toast mapping', () => {
  beforeEach(() => toast.error.mockClear());

  it('says the wait in whole seconds, singular for one', () => {
    expect(rateLimitedMessage(12)).toBe('You made too many changes in a short time. Try again in 12 seconds.');
    expect(rateLimitedMessage(1)).toBe('You made too many changes in a short time. Try again in 1 second.');
    expect(rateLimitedMessage(0.2)).toMatch(/in 1 second\.$/);
  });

  it('falls back to "a minute" when the wait is missing or nonsense', () => {
    for (const v of [undefined, null, 0, -3, Number.NaN]) expect(rateLimitedMessage(v)).toMatch(/Try again in a minute\.$/);
  });

  it('a rate_limited result toasts once with the wait and returns the same text', async () => {
    const text = rateLimitedNotice({ error: 'rate_limited', retryAfterSec: 40 });
    expect(text).toMatch(/Try again in 40 seconds\./);
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(RATE_LIMITED_TITLE, { description: text }));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('any other result: null, no toast', async () => {
    for (const error of ['forbidden', 'step_up_required', 'blocked', 'internal', undefined]) {
      expect(rateLimitedNotice({ error })).toBeNull();
    }
    await Promise.resolve();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
