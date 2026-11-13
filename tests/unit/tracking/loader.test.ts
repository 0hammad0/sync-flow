// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gate, type ConsentState } from '@/features/tracking/client/consent';

/**
 * Loader gating (2.5): what decides whether the tracker chunk is fetched at
 * all. The tracker module is mocked: "fetched" = its `start` / `choices` ran.
 */

const tracker = { start: vi.fn(), choices: vi.fn(), nav: vi.fn(), stop: vi.fn() };
vi.mock('@/features/tracking/client/tracker', () => tracker);

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

type Loader = typeof import('@/features/tracking/client/loader');

async function freshLoader(): Promise<Loader> {
  vi.resetModules();
  return import('@/features/tracking/client/loader');
}

function setNav(props: { globalPrivacyControl?: boolean; doNotTrack?: string | null }) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { configurable: true, get: () => value });
  }
}

function clearCookies() {
  for (const name of ['sf_cr', 'sf_consent']) document.cookie = `${name}=; Max-Age=0; Path=/`;
}

const settle = async () => {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  clearCookies();
  setNav({ globalPrivacyControl: undefined, doNotTrack: null });
  pathname = '/';
  history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('begin(): stop rules before the tracker chunk is fetched', () => {
  it('fetches and starts the tracker on a public page with nothing set', async () => {
    const { begin } = await freshLoader();
    begin();
    await settle();
    expect(tracker.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['GPC', () => setNav({ globalPrivacyControl: true })],
    ['DNT', () => setNav({ doNotTrack: '1' })],
    ['a stored Reject', () => (document.cookie = 'sf_consent=n; Path=/')],
    ['tracking switched off', () => (document.cookie = 'sf_cr=off; Path=/')],
    ['/admin', () => history.replaceState(null, '', '/admin')],
    ['/admin/health', () => history.replaceState(null, '', '/admin/health')],
  ])('%s → the tracker is never fetched', async (_, arrange) => {
    arrange();
    const { begin } = await freshLoader();
    begin();
    await settle();
    expect(tracker.start).not.toHaveBeenCalled();
  });

  it('starts after Accept or in a known non-consent region (the tracker re-checks the rest)', async () => {
    document.cookie = 'sf_consent=y; Path=/';
    document.cookie = 'sf_cr=eu; Path=/';
    const { begin } = await freshLoader();
    begin();
    await settle();
    expect(tracker.start).toHaveBeenCalledTimes(1);
  });
});

describe('the loader stop rule matches consent.gate', () => {
  it('for every combination of signal, choice and region', async () => {
    const { STOP_COOKIE } = await freshLoader();
    for (const signal of [false, true]) {
      for (const choice of [null, 'y', 'n']) {
        for (const region of [null, 'eu', 'ok', 'off']) {
          const jar = [choice && `sf_consent=${choice}`, region && `sf_cr=${region}`, 'other=1'].filter(Boolean).join('; ');
          const state: ConsentState = { signal, choice, region };
          const loaderStops = signal || STOP_COOKIE.test(jar);
          expect(loaderStops, jar).toBe(gate(state) === 'stop');
        }
      }
    }
  });

  it('admin paths', async () => {
    const { isAdminPath } = await freshLoader();
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/sessions')).toBe(true);
    expect(isAdminPath('/administer')).toBe(false);
    expect(isAdminPath('/')).toBe(false);
  });
});

describe('<TrackerLoader />', () => {
  it('waits for requestIdleCallback before fetching the tracker', async () => {
    const idle: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => idle.push(cb));
    const { TrackerLoader } = await freshLoader();
    render(createElement(TrackerLoader));
    await settle();
    expect(tracker.start).not.toHaveBeenCalled();
    expect(idle).toHaveLength(1);
    idle[0]();
    await settle();
    expect(tracker.start).toHaveBeenCalledTimes(1);
  });

  it('falls back to setTimeout 2 s without requestIdleCallback', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { TrackerLoader } = await freshLoader();
    render(createElement(TrackerLoader));
    vi.advanceTimersByTime(1999);
    await settle();
    expect(tracker.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await settle();
    expect(tracker.start).toHaveBeenCalledTimes(1);
  });

  it('renders nothing and passes client navigations to the tracker once loaded', async () => {
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());
    const { TrackerLoader } = await freshLoader();
    const view = render(createElement(TrackerLoader));
    expect(view.container.innerHTML).toBe('');
    await settle();
    pathname = '/chat';
    await act(async () => view.rerender(createElement(TrackerLoader)));
    expect(tracker.nav).toHaveBeenCalledWith('/chat');
  });

  it('never fetches the tracker while mounted on /admin', async () => {
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());
    history.replaceState(null, '', '/admin/health');
    pathname = '/admin/health';
    const { TrackerLoader } = await freshLoader();
    render(createElement(TrackerLoader));
    await settle();
    expect(tracker.start).not.toHaveBeenCalled();
  });
});

describe('"Privacy choices" link', () => {
  function link() {
    const a = document.createElement('a');
    a.href = '/privacy#rights';
    a.setAttribute('data-privacy-choices', '');
    a.textContent = 'Privacy choices';
    document.body.append(a);
    return a;
  }

  it('opens the banner through the tracker chunk and keeps the page', async () => {
    await freshLoader();
    const a = link();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    // Every fresh module instance in this file adds its own listener; in the app the module loads once.
    expect(tracker.choices).toHaveBeenCalled();
    a.remove();
  });

  it('with GPC on, loads nothing and lets the link open the privacy page', async () => {
    setNav({ globalPrivacyControl: true });
    await freshLoader();
    const a = link();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(tracker.choices).not.toHaveBeenCalled();
    a.remove();
  });
});
