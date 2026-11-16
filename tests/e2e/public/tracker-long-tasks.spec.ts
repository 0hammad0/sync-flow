import { expect, test } from '@playwright/test';

import { answerProbe, hidePage } from '../support/tracker';

/**
 * Performance proof (phase 2.9): the tracker adds 0 long tasks (> 50 ms).
 * CPU slowed 4x (Lighthouse's mobile setting). A long task counts against
 * the tracker when it contains a moment the tracker is known to run:
 * - its start (the region probe is fetched synchronously from `start()`,
 *   in the same task that evaluated the tracker chunk), and
 * - each flush (`sendBeacon` call), on hidden and on pagehide.
 * Scroll and pointer handlers set a flag / do arithmetic only.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(!['w390', 'w1366'].includes(testInfo.project.name), 'phone and laptop widths');
});

type Probe = { longTasks: { start: number; duration: number }[]; marks: { what: string; at: number }[] };

for (const path of ['/', '/chat']) {
  test(`${path}: 0 long tasks from the tracker (scroll, clicks, flushes; CPU 4x slower)`, async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    await page.addInitScript(() => {
      const w = window as unknown as { __probe: Probe };
      w.__probe = { longTasks: [], marks: [] };
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__probe.longTasks.push({ start: e.startTime, duration: e.duration });
      }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as PerformanceResourceTiming[]) {
          if (new URL(e.name).pathname === '/api/e' && e.initiatorType === 'fetch') w.__probe.marks.push({ what: 'start', at: e.startTime });
        }
      }).observe({ type: 'resource', buffered: true });
      const send = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        w.__probe.marks.push({ what: 'flush', at: performance.now() });
        return send(url, data);
      };
    });

    const log = await answerProbe(page, 'ok');
    await page.goto(path);
    await expect.poll(() => log.probes.length, { timeout: 15_000 }).toBe(1);

    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(120);
    }
    const vp = page.viewportSize()!;
    for (let i = 0; i < 5; i++) {
      // Clicks on empty page margin: real pointer events, no navigation.
      await page.mouse.click(4, Math.round(vp.height / 2) + i * 10);
      await page.waitForTimeout(80);
    }
    await page.mouse.wheel(0, -3000);
    await hidePage(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await expect.poll(() => log.flushes.length).toBe(2);
    await page.waitForTimeout(300);

    const probe = await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe);
    expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('longtask'))).toBe(true);
    expect(probe.marks.map((m) => m.what)).toEqual(['start', 'flush', 'flush']);

    const fromTracker = probe.longTasks.filter((t) => probe.marks.some((m) => m.at >= t.start && m.at <= t.start + t.duration));
    test.info().annotations.push({
      type: 'long tasks',
      description: `${probe.longTasks.length} on the page (hydration etc.), ${fromTracker.length} from the tracker`,
    });
    expect(fromTracker).toEqual([]);
  });
}

/**
 * Per-click cost (phase 4): the click chunk's one `pointerup` listener on
 * `document` is timed from inside the page (an init script wraps exactly that
 * listener), over real buttons and links. Budget: < 1 ms each, and 0 long
 * tasks while clicking. Synthetic pointerups: no navigation, no app action.
 */
test('click capture: < 1 ms main-thread time per click, 0 long tasks', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __clicks: number[]; __long: number };
    w.__clicks = [];
    w.__long = 0;
    new PerformanceObserver((list) => {
      w.__long += list.getEntries().length;
    }).observe({ type: 'longtask' });
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this === document && type === 'pointerup' && typeof listener === 'function') {
        const inner = listener;
        const timed = function (this: unknown, event: Event) {
          const t = performance.now();
          inner.call(this, event);
          w.__clicks.push(performance.now() - t);
        };
        return add.call(this, type, timed, options);
      }
      return add.call(this, type, listener, options);
    };
  });
  const log = await answerProbe(page, 'ok');
  await page.goto('/');
  await expect.poll(() => log.probes.length, { timeout: 15_000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __clicks: number[] }).__clicks !== undefined)).toBe(true);
  await page.waitForTimeout(1_000); // click chunk loaded
  await page.evaluate(() => (window as unknown as { __long: number }).__long = 0);

  await page.evaluate(() => {
    const targets = [...document.querySelectorAll('a, button, [role=button], [data-track]')].slice(0, 20);
    for (let i = 0; i < 40; i++) {
      const el = targets[i % targets.length];
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, isPrimary: true, button: 0, clientX: 10 + i * 40, clientY: 10 }));
    }
  });
  await page.waitForTimeout(1_500); // dead checks end

  const { clicks, long } = await page.evaluate(() => {
    const w = window as unknown as { __clicks: number[]; __long: number };
    return { clicks: w.__clicks, long: w.__long };
  });
  expect(clicks.length).toBeGreaterThanOrEqual(40);
  const sorted = [...clicks].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  test.info().annotations.push({ type: 'per-click ms', description: `median ${sorted[sorted.length >> 1].toFixed(3)}, p95 ${p95.toFixed(3)}, max ${sorted.at(-1)!.toFixed(3)}` });
  expect(p95).toBeLessThan(1);
  expect(long).toBe(0);

  await hidePage(page);
  await expect.poll(() => log.flushes.flatMap((f) => f.body.events).filter((e) => e.type === 'click').length).toBeGreaterThanOrEqual(40);
});
