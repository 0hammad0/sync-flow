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
