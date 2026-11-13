import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The cron route deletes files, so it must refuse every caller without the
// exact secret, and fail closed when the secret is not configured at all.
async function call(auth?: string) {
  const { GET } = await import('@/app/api/cleanup/route');
  const headers = auth ? { authorization: auth } : undefined;
  return GET(new NextRequest('http://localhost/api/cleanup', { headers }));
}

describe('GET /api/cleanup auth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses everyone when CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('Bearer anything');
    expect(res.status).toBe(401);
  });

  it('refuses a missing or wrong secret', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong-secret')).status).toBe(401);
    expect((await call('right-secret')).status).toBe(401);
  });
});
