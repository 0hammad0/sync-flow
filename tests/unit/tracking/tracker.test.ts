// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseBeacon } from '@/features/tracking/schemas';

/**
 * Tracker rules (2.5, 2.8): batching and flush rules, caps, bfcache, consent
 * gate, privacy of what is sent, Web Vitals sampling, never throwing.
 * Fake timers for the 60 s checkpoint and engaged time; jsdom for the DOM.
 */

const ask = vi.fn<(focus?: boolean) => Promise<'y' | 'n'>>();
vi.mock('@/features/tracking/client/banner', () => ({ ask: (focus?: boolean) => ask(focus) }));

type VitalsCb = (v: { lcp?: number; inp?: number; cls?: number }) => void;
let vitalsCb: VitalsCb | null = null;
const watchVitals = vi.fn((cb: VitalsCb) => (vitalsCb = cb));
vi.mock('@/features/tracking/client/vitals', () => ({ watchVitals: (cb: VitalsCb) => watchVitals(cb) }));

type Tracker = typeof import('@/features/tracking/client/tracker');
type Sent = { sid: string; seq: number; final?: boolean; events: Record<string, unknown>[] };

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
let referrer = '';
Object.defineProperty(document, 'referrer', { configurable: true, get: () => referrer });

let sent: Sent[] = [];
let beaconOk = true;
const sendBeacon = vi.fn((url: string, body: string) => {
  expect(url).toBe('/api/e');
  if (beaconOk) sent.push(JSON.parse(body));
  return beaconOk;
});
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') sent.push(JSON.parse(String(init.body)));
  else if (probeAnswer) document.cookie = `sf_cr=${probeAnswer}; Path=/`;
  return new Response(null, { status: 204 });
});
let probeAnswer: string | null = 'ok';

let current: Tracker | null = null;

const T0 = Date.parse('2026-11-13T10:00:00Z');
const settle = async () => {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function startAt(path: string): Promise<Tracker> {
  history.replaceState(null, '', path);
  vi.resetModules();
  current = await import('@/features/tracking/client/tracker');
  current.start();
  await settle();
  return current;
}

function hide() {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
}
function show() {
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
}
function pagehide(persisted = false) {
  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted }));
}
function pageshow(persisted: boolean) {
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
}
const input = () => document.dispatchEvent(new Event('pointerdown'));

function setNav(props: { globalPrivacyControl?: boolean; doNotTrack?: string | null }) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { configurable: true, get: () => value });
  }
}

const events = (type: string) => sent.flatMap((b) => b.events).filter((e) => e.type === type);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame'] });
  vi.setSystemTime(T0);
  sent = [];
  beaconOk = true;
  probeAnswer = 'ok';
  visibility = 'visible';
  referrer = '';
  vitalsCb = null;
  vi.clearAllMocks();
  sessionStorage.clear();
  for (const name of ['sf_cr', 'sf_consent']) document.cookie = `${name}=; Max-Age=0; Path=/`;
  document.cookie = 'sf_cr=ok; Path=/';
  setNav({ globalPrivacyControl: undefined, doNotTrack: null });
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // not a Web Vitals session unless a test says so
});

afterEach(() => {
  current?.stop();
  current = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('flush rules (few writes)', () => {
  it('keeps events in the browser: nothing is sent on load or per event', async () => {
    await startAt('/');
    input();
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([]);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('hidden → one flush with the page view and engaged time, seq 0, not final', async () => {
    await startAt('/');
    vi.advanceTimersByTime(4_000);
    hide();
    expect(sent).toHaveLength(1);
    const [b] = sent;
    expect(b).toMatchObject({ seq: 0, events: [{ type: 'pageview', path: '/', pv: '1' }, { type: 'engage', pv: '1', ms: 4_000, scroll: expect.any(Number) }] });
    expect(b.final).toBeUndefined();
    expect(b.sid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('every flush is accepted by the server schema as-is', async () => {
    referrer = 'https://news.example.com/story?id=1';
    await startAt('/chat/AB12CD?utm_source=nl&utm_campaign=launch');
    vi.advanceTimersByTime(1_000);
    hide();
    show();
    vi.advanceTimersByTime(1_000);
    pagehide();
    expect(sent.length).toBeGreaterThanOrEqual(2);
    for (const body of sent) {
      const parsed = parseBeacon(body);
      expect(parsed, JSON.stringify(body)).not.toBeNull();
      expect(parsed!.invalid).toBe(0);
    }
  });

  it('a 60 s checkpoint while visible, only when there is something new', async () => {
    await startAt('/');
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(1); // page view + 30 s engaged (then idle)
    expect(sent[0].events.map((e) => e.type)).toEqual(['pageview', 'engage']);
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(1); // idle: nothing new, nothing sent
    input();
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ seq: 1, events: [{ type: 'engage', ms: 30_000 }] });
  });

  it('no checkpoint while hidden', async () => {
    await startAt('/');
    hide();
    const after = sent.length;
    vi.advanceTimersByTime(180_000);
    expect(sent).toHaveLength(after);
  });

  it('pagehide sends the final flush (even with nothing new) and ends the session', async () => {
    await startAt('/');
    hide();
    pagehide();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ seq: 1, final: true, events: [{ type: 'engage', pv: '1', ms: 0 }] });
    expect(sessionStorage.getItem('sf_s')).toBeNull();
  });

  it('never listens to unload or beforeunload', async () => {
    const types: string[] = [];
    for (const target of [window, document]) {
      const orig = target.addEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation((type: string, ...rest: unknown[]) => {
        types.push(type);
        return orig(type, ...(rest as [EventListener]));
      });
    }
    await startAt('/');
    expect(types).toEqual(expect.arrayContaining(['visibilitychange', 'pagehide', 'pageshow']));
    expect(types).not.toContain('unload');
    expect(types).not.toContain('beforeunload');
  });

  it('sendBeacon refused or throwing → fetch with keepalive', async () => {
    await startAt('/');
    beaconOk = false;
    hide();
    expect(fetchMock).toHaveBeenCalledWith('/api/e', expect.objectContaining({ method: 'POST', keepalive: true }));
    expect(sent).toHaveLength(1);
    show();
    input();
    vi.advanceTimersByTime(1_000);
    sendBeacon.mockImplementationOnce(() => {
      throw new TypeError('no beacon');
    });
    expect(() => hide()).not.toThrow();
    expect(sent).toHaveLength(2);
  });

  it('flushes early when the queue reaches 40 events', async () => {
    const t = await startAt('/');
    for (let i = 0; i < 39; i++) t.nav(i % 2 ? '/chat' : '/send');
    expect(sent).toHaveLength(1);
    expect(sent[0].events.length).toBeLessThanOrEqual(50);
    expect(sent[0].events.length).toBeGreaterThanOrEqual(40);
  });
});

describe('caps and session id', () => {
  it('counts at most 100 page views per session', async () => {
    const t = await startAt('/');
    for (let i = 0; i < 150; i++) t.nav(i % 2 ? '/chat' : '/send');
    hide();
    expect(events('pageview')).toHaveLength(100);
    expect(JSON.parse(sessionStorage.getItem('sf_s')!).p).toBe(100);
  });

  it('counts at most 300 clicks per session (phase 4 asks takeClick)', async () => {
    const t = await startAt('/');
    let taken = 0;
    for (let i = 0; i < 350; i++) if (t.takeClick()) taken++;
    expect(taken).toBe(300);
    expect(JSON.parse(sessionStorage.getItem('sf_s')!).c).toBe(300);
  });

  it('keeps the session id in sessionStorage across a reload until the final flush', async () => {
    await startAt('/');
    hide();
    const sid = sent[0].sid;
    const stored = sessionStorage.getItem('sf_s')!;
    expect(JSON.parse(stored)).toMatchObject({ i: sid, q: 1, p: 1 });
    // A fresh document in the same tab with no final flush in between (e.g. the
    // OS killed the page after `hidden`): same session, next seq, next pv id.
    current!.stop();
    sessionStorage.setItem('sf_s', stored);
    show();
    await startAt('/chat');
    hide();
    expect(sent.at(-1)).toMatchObject({ sid, seq: 1, events: [{ type: 'pageview', path: '/chat', pv: '2' }] });
  });

  it('back/forward cache restore (pageshow persisted) starts a new session', async () => {
    await startAt('/');
    pagehide(true);
    const first = sent[0].sid;
    pageshow(true);
    hide();
    const last = sent.at(-1)!;
    expect(last.sid).not.toBe(first);
    expect(last.seq).toBe(0);
    expect(last.events[0]).toMatchObject({ type: 'pageview', path: '/', pv: '1' });
  });

  it('a normal pageshow keeps the session', async () => {
    await startAt('/');
    pageshow(false);
    hide();
    expect(sent).toHaveLength(1);
    expect(events('pageview')).toHaveLength(1);
  });
});

describe('engaged time', () => {
  it('counts only while visible and pauses after 30 s without input', async () => {
    await startAt('/');
    vi.advanceTimersByTime(10_000);
    input();
    vi.advanceTimersByTime(50_000); // 30 s counted after the input, then idle
    hide();
    expect(events('engage')[0].ms).toBe(40_000);
    vi.advanceTimersByTime(100_000); // hidden: not counted
    show();
    vi.advanceTimersByTime(5_000);
    pagehide();
    expect(events('engage').at(-1)!.ms).toBe(5_000);
  });

  it('records the deepest scroll quarter', async () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 3_000 });
    vi.stubGlobal('innerHeight', 1_000);
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 16));
    await startAt('/');
    vi.stubGlobal('scrollY', 1_100); // 55 % of the 2,000 px range
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20); // requestAnimationFrame
    hide();
    expect(events('engage')[0].scroll).toBe(50);
  });
});

describe('privacy of what is sent', () => {
  it('masks room codes and tokens, drops the query string except utm_*, referrer host only', async () => {
    referrer = 'https://news.example.com/path?secret=1';
    await startAt('/share/tok_secret?name=report.pdf&utm_source=nl&utm_medium=email&q=hello');
    const t = current!;
    t.nav('/chat/AB12CD');
    t.nav('/send/tok_2');
    hide();
    const body = JSON.stringify(sent);
    expect(body).not.toMatch(/tok_secret|AB12CD|tok_2|report\.pdf|hello|secret=1|\/path/);
    expect(events('pageview').map((e) => e.path)).toEqual(['/share/[token]', '/chat/[code]', '/send/[token]']);
    expect(events('pageview')[0]).toMatchObject({ ref: 'news.example.com', utm_source: 'nl', utm_medium: 'email' });
    expect(events('pageview')[1]).not.toHaveProperty('ref');
  });

  it('own host as referrer is not sent', async () => {
    referrer = `${location.origin}/chat`;
    await startAt('/');
    hide();
    expect(events('pageview')[0]).not.toHaveProperty('ref');
  });

  it('never sends admin or unknown pages, and does not count time on them', async () => {
    const t = await startAt('/');
    t.nav('/admin/health');
    vi.advanceTimersByTime(20_000);
    t.nav('/no-such-page');
    hide();
    expect(events('pageview').map((e) => e.path)).toEqual(['/']);
    expect(JSON.stringify(sent)).not.toMatch(/admin|no-such-page/);
  });

  it('sends no typed text: only the strict event keys', async () => {
    await startAt('/chat');
    const box = document.createElement('textarea');
    document.body.append(box);
    box.value = 'my secret message';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    hide();
    expect(JSON.stringify(sent)).not.toContain('secret');
    for (const e of sent.flatMap((b) => b.events)) {
      expect(Object.keys(e).every((k) => ['type', 't', 'pv', 'path', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'vw', 'vh', 'ms', 'scroll', 'lcp', 'inp', 'cls'].includes(k))).toBe(true);
    }
    box.remove();
  });
});

describe('consent gate inside the tracker', () => {
  it('GPC → no probe, no banner, nothing sent', async () => {
    setNav({ globalPrivacyControl: true });
    await startAt('/');
    hide();
    pagehide();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it('unknown region → one GET probe, then runs where no consent is needed', async () => {
    document.cookie = 'sf_cr=; Max-Age=0; Path=/';
    probeAnswer = 'ok';
    await startAt('/');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(['/api/e']);
    hide();
    expect(sent).toHaveLength(1);
  });

  it('probe says off (kill switch) → nothing is sent', async () => {
    document.cookie = 'sf_cr=; Max-Age=0; Path=/';
    probeAnswer = 'off';
    await startAt('/');
    hide();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('EU without a choice → banner; Reject → no tracker request', async () => {
    document.cookie = 'sf_cr=eu; Path=/';
    ask.mockResolvedValueOnce('n');
    await startAt('/');
    expect(ask).toHaveBeenCalledTimes(1);
    hide();
    pagehide();
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('EU → banner; Accept → runs', async () => {
    document.cookie = 'sf_cr=eu; Path=/';
    ask.mockImplementationOnce(async () => {
      document.cookie = 'sf_consent=y; Path=/';
      return 'y';
    });
    await startAt('/');
    hide();
    expect(sent).toHaveLength(1);
  });

  it('switched off mid-session (sf_cr=off from /api/e) → stops and sends nothing more', async () => {
    await startAt('/');
    document.cookie = 'sf_cr=off; Path=/';
    hide();
    pagehide();
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('sf_s')).toBeNull();
  });

  it('Reject from Privacy choices stops a running tracker; Accept restarts it', async () => {
    const t = await startAt('/');
    ask.mockImplementationOnce(async () => {
      document.cookie = 'sf_consent=n; Path=/';
      return 'n';
    });
    t.choices();
    await settle();
    expect(ask).toHaveBeenCalledWith(true);
    hide();
    expect(sendBeacon).not.toHaveBeenCalled();

    show();
    ask.mockImplementationOnce(async () => {
      document.cookie = 'sf_consent=y; Path=/';
      return 'y';
    });
    t.choices();
    await settle();
    hide();
    expect(sent).toHaveLength(1);
  });
});

describe('Web Vitals (1 in 10 sessions)', () => {
  it('not sampled → web-vitals is never loaded', async () => {
    await startAt('/');
    await settle();
    expect(watchVitals).not.toHaveBeenCalled();
  });

  it('sampled → loads web-vitals and sends the latest LCP/INP/CLS with the next flush, no extra write', async () => {
    vi.mocked(Math.random).mockReturnValue(0.05);
    await startAt('/');
    await settle();
    expect(watchVitals).toHaveBeenCalledTimes(1);
    vitalsCb!({ lcp: 1234 });
    vitalsCb!({ lcp: 1234, cls: 0.0123, inp: 88 });
    expect(sent).toEqual([]); // not sent on its own
    hide();
    expect(sent).toHaveLength(1);
    expect(events('vitals')).toEqual([{ type: 'vitals', t: T0, lcp: 1234, cls: 0.0123, inp: 88 }]);
    show();
    pagehide();
    expect(events('vitals')).toHaveLength(1); // unchanged values are not re-sent
  });
});

describe('errors never reach the page', () => {
  it('works without sessionStorage (private mode)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    await startAt('/');
    expect(() => hide()).not.toThrow();
    expect(sent).toHaveLength(1);
  });

  it('a failing probe leaves the tracker off, silently', async () => {
    document.cookie = 'sf_cr=; Max-Age=0; Path=/';
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await startAt('/');
    hide();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('start() twice does not double the listeners', async () => {
    const t = await startAt('/');
    t.start();
    await settle();
    hide();
    expect(sent).toHaveLength(1);
  });
});
