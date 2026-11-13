import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const run = vi.fn(async () => ({ status: 'ok', counts: {}, error: null }));

vi.mock('@/server/container', () => ({
  getTrackingContainer: () => ({ rollup: { run } }),
}));

// The cron deletes analytics data, so it must refuse every caller without the
// exact secret, and fail closed when the secret is not configured at all.
async function call(auth?: string, method: 'GET' | 'POST' = 'GET') {
  const route = await import('@/app/api/admin/cron/rollup/route');
  const headers = auth ? { authorization: auth } : undefined;
  return route[method](new NextRequest('http://localhost/api/admin/cron/rollup', { method, headers }));
}

describe('/api/admin/cron/rollup auth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    run.mockClear();
  });

  it('refuses everyone when CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call('Bearer anything')).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a missing or wrong secret', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong-secret')).status).toBe(401);
    expect((await call('right-secret')).status).toBe(401);
    expect((await call('Bearer right-secretx')).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs once with the right secret (GET from Vercel Cron, POST by hand)', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    const res = await call('Bearer right-secret');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
    expect((await call('Bearer right-secret', 'POST')).status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
