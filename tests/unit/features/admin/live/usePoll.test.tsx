import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePoll } from '@/features/admin/live/hooks/usePoll';
import { getIdleStore } from '@/features/admin/live/hooks/usePollGate';
import { IDLE_AFTER_MS, LIVE_POLL_MS } from '@/features/admin/live/poll';

// T-26 in the browser: polls every 30 s while visible, none while hidden (one
// at once on return), none after 10 min without input until "resume", none
// while paused, and none after 3 failures in a row.

type Data = { n: number };

function Probe({ paused = false, at }: { paused?: boolean; at: number }) {
  const { snapshot, mode, resumeIdle } = usePoll<Data>({
    queryKey: ['test-poll'],
    url: '/api/admin/live',
    intervalMs: LIVE_POLL_MS,
    initial: { data: { n: 0 }, at },
    paused,
  });
  return (
    <div>
      <p data-testid="state">
        {mode}:{snapshot.status}:{snapshot.data?.n}
      </p>
      <button type="button" onClick={resumeIdle}>
        resume
      </button>
    </div>
  );
}

let visibility: DocumentVisibilityState = 'visible';
let served = 0;
let failWith: number | null = null;
const fetchMock = vi.fn(async () => {
  if (failWith) return { status: failWith, json: async () => ({ state: 'error', errorId: 'e' }) } as Response;
  served += 1;
  return { status: 200, json: async () => ({ state: 'ok', data: { n: served } }) } as Response;
});

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
}

/**
 * Moves the clock, then lets TanStack's batched updates render. Its
 * `setTimeout(fn, 0)` lands 1 ms later under fake timers when scheduled
 * mid-tick, so the flush adds 3 ms per call (far below any poll interval).
 */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(1);
  });

function mount(paused = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Probe paused={paused} at={Date.now()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  visibility = 'visible';
  served = 0;
  failWith = null;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  getIdleStore().resume();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('usePoll (T-26)', () => {
  it('renders the server data with no fetch, then polls every 30 s while visible', async () => {
    mount();
    expect(screen.getByTestId('state').textContent).toBe('running:ok:0');
    await advance(LIVE_POLL_MS - 10);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('state').textContent).toBe('running:ok:1');
    await advance(LIVE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('makes no request while the tab is hidden, and one at once when it is back', async () => {
    mount();
    await act(async () => setVisibility('hidden'));
    expect(screen.getByTestId('state').textContent).toMatch(/^hidden:/);
    await advance(5 * LIVE_POLL_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => setVisibility('visible'));
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(LIVE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after 10 min with no input; "resume" fetches at once and polls again', async () => {
    mount();
    await advance(IDLE_AFTER_MS);
    expect(screen.getByTestId('state').textContent).toMatch(/^idle:/);
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(IDLE_AFTER_MS / LIVE_POLL_MS);
    await advance(5 * LIVE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(calls);

    fireEvent.click(screen.getByRole('button', { name: 'resume' }));
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(calls + 1);
    expect(screen.getByTestId('state').textContent).toMatch(/^running:/);
    await advance(LIVE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(calls + 2);
  });

  it('input keeps it running past 10 min', async () => {
    mount();
    await advance(IDLE_AFTER_MS - 60_000);
    fireEvent.keyDown(window, { key: 'a' });
    await advance(2 * 60_000);
    expect(screen.getByTestId('state').textContent).toMatch(/^running:/);
  });

  it('makes no request while paused', async () => {
    mount(true);
    expect(screen.getByTestId('state').textContent).toMatch(/^paused:/);
    await advance(5 * LIVE_POLL_MS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the last data on failures and stops after 3 in a row', async () => {
    mount();
    failWith = 500;
    await advance(LIVE_POLL_MS);
    expect(screen.getByTestId('state').textContent).toBe('running:failing:0');
    await advance(2 * LIVE_POLL_MS);
    expect(screen.getByTestId('state').textContent).toBe('stopped:stopped:0');
    await advance(5 * LIVE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops for good on 401', async () => {
    mount();
    failWith = 401;
    await advance(LIVE_POLL_MS);
    expect(screen.getByTestId('state').textContent).toBe('stopped:unauthorized:0');
    await advance(5 * LIVE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
