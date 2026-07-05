/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * Caveat for production: this is per-process memory, so on Vercel serverless
 * it's per-cold-instance and not cluster-wide. Good enough for casual abuse
 * prevention; for serious rate limiting use Upstash Redis or a similar
 * external store. Used here to throttle chat message sends so a misbehaving
 * client can't burn through the Firestore free tier.
 */

const buckets = new Map<string, number[]>();

const MAX_KEYS = 5000;

export function rateLimit(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    const oldest = arr[0];
    return { allowed: false, retryAfterMs: windowMs - (now - oldest) };
  }
  arr.push(now);
  buckets.set(key, arr);

  // Crude GC so the map doesn't grow unbounded under attack.
  if (buckets.size > MAX_KEYS) {
    // delete oldest half-ish (Map preserves insertion order)
    let toDrop = Math.floor(MAX_KEYS / 2);
    for (const k of buckets.keys()) {
      if (toDrop-- <= 0) break;
      buckets.delete(k);
    }
  }

  return { allowed: true, retryAfterMs: 0 };
}

/** Extract a best-effort client identifier from a request for rate limiting. */
export function clientKey(request: Request): string {
  // Vercel forwards the real client IP in this header.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  return ip;
}
