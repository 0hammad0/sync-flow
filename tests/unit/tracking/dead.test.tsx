import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkDead } from '@/features/tracking/client/clicks';

/**
 * Dead rule (07-tracker.md): no DOM change, navigation or focus loss within
 * 1 s after a click → `dead`. One MutationObserver while any check runs,
 * disconnected when the last one ends.
 */

const flushMutations = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('dead click detector', () => {
  let observed = 0;
  let disconnected = 0;
  const Real = MutationObserver;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    observed = 0;
    disconnected = 0;
    vi.stubGlobal(
      'MutationObserver',
      class extends Real {
        observe(target: Node, options?: MutationObserverInit) {
          observed += 1;
          super.observe(target, options);
        }
        disconnect() {
          disconnected += 1;
          super.disconnect();
        }
      },
    );
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    document.body.innerHTML = '<button>Send</button><div id="out"></div>';
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('nothing changes for 1 s → dead', () => {
    const onDead = vi.fn();
    checkDead(onDead);
    vi.advanceTimersByTime(999);
    expect(onDead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('a DOM change inside the second → not dead', async () => {
    const onDead = vi.fn();
    checkDead(onDead);
    vi.advanceTimersByTime(400);
    document.getElementById('out')!.textContent = 'Sent';
    await flushMutations();
    vi.advanceTimersByTime(600);
    expect(onDead).not.toHaveBeenCalled();
  });

  it('an attribute change (e.g. a toggled state) also counts', async () => {
    const onDead = vi.fn();
    checkDead(onDead);
    document.querySelector('button')!.setAttribute('aria-expanded', 'true');
    await flushMutations();
    vi.advanceTimersByTime(1_000);
    expect(onDead).not.toHaveBeenCalled();
  });

  it('a navigation (URL change) → not dead', () => {
    const onDead = vi.fn();
    checkDead(onDead);
    history.pushState(null, '', '/send');
    vi.advanceTimersByTime(1_000);
    expect(onDead).not.toHaveBeenCalled();
  });

  it('the page lost focus (file picker, new tab) → not dead', () => {
    const onDead = vi.fn();
    checkDead(onDead);
    vi.mocked(document.hasFocus).mockReturnValue(false);
    vi.advanceTimersByTime(1_000);
    expect(onDead).not.toHaveBeenCalled();
  });

  it('a change before the click does not save it', async () => {
    document.getElementById('out')!.textContent = 'earlier';
    await flushMutations();
    const onDead = vi.fn();
    checkDead(onDead);
    vi.advanceTimersByTime(1_000);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('one observer for overlapping checks, disconnected after the last one ends', () => {
    const a = vi.fn();
    const b = vi.fn();
    checkDead(a);
    vi.advanceTimersByTime(500);
    checkDead(b);
    expect(observed).toBe(1);
    vi.advanceTimersByTime(500);
    expect(disconnected).toBe(0);
    vi.advanceTimersByTime(500);
    expect(disconnected).toBe(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
