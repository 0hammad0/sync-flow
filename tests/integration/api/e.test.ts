import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduled: (() => unknown)[] = [];
const ingest = vi.fn(async (...args: unknown[]) => (void args, 'written'));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    scheduled.push(task);
  },
}));

// No Firebase in this test: the route must not touch the container before after().
vi.mock('@/server/container', () => ({
  getTrackingContainer: () => ({ ingest: { ingest } }),
}));

const SID = '0123456789abcdef0123456789abcdef';
const pageview = { type: 'pageview', t: 1_763_000_000_000, pv: 'p1', path: '/chat/AB12CD', vw: 390, vh: 844 };
let ipSeq = 0;

function post(body: unknown, headers: Record<string, string> = {}) {
  ipSeq += 1;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest('http://localhost:3000/api/e', {
    method: 'POST',
    body: text,
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'text/plain',
      'x-real-ip': `198.51.100.${ipSeq % 250}`,
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1',
      ...headers,
    },
  });
}

async function call(req: NextRequest) {
  const { POST } = await import('@/app/api/e/route');
  return POST(req);
}

describe('POST /api/e', () => {
  beforeEach(() => {
    scheduled.length = 0;
    ingest.mockClear();
  });

  it('answers 204 at once and does the work in after()', async () => {
    const res = await call(post({ sid: SID, seq: 0, events: [pageview] }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(ingest).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    await scheduled[0]();
    expect(ingest).toHaveBeenCalledTimes(1);
    const [beacon, meta] = ingest.mock.calls[0] as unknown as [{ events: { path: string }[] }, { ip: string; host: string }];
    expect(beacon.events[0].path).toBe('/chat/[code]');
    expect(meta).toMatchObject({ ip: expect.stringMatching(/^198\.51\.100\./), host: 'localhost:3000' });
  });

  it('accepts a Referer from our host when Origin is missing', async () => {
    const res = await call(post({ sid: SID, seq: 0, events: [pageview] }, { origin: '', referer: 'http://localhost:3000/chat/x' }));
    expect(res.status).toBe(204);
    expect(scheduled).toHaveLength(1);
  });

  it.each([
    ['a foreign origin', { origin: 'https://evil.example' }],
    ['no origin and no referer', { origin: '' }],
    ['a "null" origin and a foreign referer', { origin: 'null', referer: 'https://evil.example/' }],
  ])('drops %s (still 204)', async (_, headers) => {
    const res = await call(post({ sid: SID, seq: 0, events: [pageview] }, headers));
    expect(res.status).toBe(204);
    expect(scheduled).toHaveLength(0);
  });

  it('drops a body over 16 KB (declared or streamed)', async () => {
    const big = { sid: SID, seq: 0, events: [pageview], pad: 'x'.repeat(17_000) };
    expect((await call(post(big))).status).toBe(204);
    const streamed = new NextRequest('http://localhost:3000/api/e', {
      method: 'POST',
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('x'.repeat(20_000)));
          c.close();
        },
      }),
      duplex: 'half',
      headers: { origin: 'http://localhost:3000', 'x-real-ip': '192.0.2.1', 'user-agent': 'x' },
    });
    expect((await call(streamed)).status).toBe(204);
    expect(scheduled).toHaveLength(0);
  });

  it('drops more than 50 events, bad JSON and a bad envelope', async () => {
    for (const body of [
      { sid: SID, seq: 0, events: Array(51).fill(pageview) },
      '{not json',
      { sid: 'nope', seq: 0, events: [pageview] },
      { sid: SID, seq: 0, events: [] },
    ]) {
      expect((await call(post(body))).status).toBe(204);
    }
    expect(scheduled).toHaveLength(0);
  });

  it('rate limits per IP (still 204)', async () => {
    const headers = { 'x-real-ip': '192.0.2.77' };
    for (let i = 0; i < 60; i++) await call(post({ sid: SID, seq: i, events: [pageview] }, headers));
    expect(scheduled).toHaveLength(60);
    const res = await call(post({ sid: SID, seq: 60, events: [pageview] }, headers));
    expect(res.status).toBe(204);
    expect(scheduled).toHaveLength(60);
  });

  it('a batch with only invalid events is still handed to ingest (to count drops)', async () => {
    await call(post({ sid: SID, seq: 0, events: [{ ...pageview, path: '/admin' }] }));
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(ingest.mock.calls[0][0]).toMatchObject({ events: [], invalid: 1 });
  });
});
