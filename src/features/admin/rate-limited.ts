// Client side of the admin write limit (phase 5.4). An admin write action
// that is over 30 writes a minute returns
//   { ok: false, error: 'rate_limited', retryAfterSec }
// (src/server/auth/admin-write-limit.ts). Every screen shows the same toast
// with the wait, and the same text inline where it has an error slot.
//
// Usage in a component that handles an action result:
//   const limited = rateLimitedNotice(result);
//   if (limited) return { ok: false, error: result.error, message: limited };
// A screen that already shows its own error toast uses rateLimitedMessage()
// as that toast's description instead, so it does not toast twice.

export const RATE_LIMITED_TITLE = 'Too many changes';

/** "Try again in 12 seconds." The wait is rounded up to whole seconds. */
export function rateLimitedMessage(retryAfterSec?: number | null): string {
  if (!retryAfterSec || !Number.isFinite(retryAfterSec) || retryAfterSec <= 0) {
    return 'You made too many changes in a short time. Try again in a minute.';
  }
  const sec = Math.ceil(retryAfterSec);
  return `You made too many changes in a short time. Try again in ${sec} ${sec === 1 ? 'second' : 'seconds'}.`;
}

/** sonner loads lazily (LazyToaster), so import it on use. */
export async function toastRateLimited(retryAfterSec?: number | null): Promise<void> {
  const { toast } = await import('sonner');
  toast.error(RATE_LIMITED_TITLE, { description: rateLimitedMessage(retryAfterSec) });
}

/**
 * For a rate-limited action result: shows the toast with the wait and returns
 * the same text for an inline error. Anything else: `null`, nothing shown.
 */
export function rateLimitedNotice(result: { error?: unknown; retryAfterSec?: number | null }): string | null {
  if (result.error !== 'rate_limited') return null;
  void toastRateLimited(result.retryAfterSec);
  return rateLimitedMessage(result.retryAfterSec);
}
