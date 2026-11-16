import { describe, expect, it } from 'vitest';

import { failureOf } from '@/features/admin/export/download';

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('export failure copy', () => {
  it('a per-admin rate limit shows the wait from Retry-After and is final', async () => {
    expect(await failureOf(res(429, { success: false, error: 'rate_limited' }, { 'Retry-After': '12' }))).toEqual({
      message: 'Too many requests in a short time. Try again in 12 seconds.',
      final: true,
    });
  });

  it('the read-budget 429 keeps its own message', async () => {
    expect(await failureOf(res(429, { ok: false, error: 'budget', message: 'Budget used up.' }))).toEqual({
      message: 'Budget used up.',
      final: true,
    });
  });
});
