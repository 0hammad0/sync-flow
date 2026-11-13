import { expect, test, type Page } from '@playwright/test';

import { answerProbe, hidePage, settleIdle } from '../support/tracker';

// Consent (phase 2.2, mode A) and privacy signals. Two widths: phone and laptop.
test.beforeEach(({}, testInfo) => {
  test.skip(!['w390', 'w1366'].includes(testInfo.project.name), 'consent behaviour is width-independent; banner checked at two widths');
});

const banner = (page: Page) => page.locator('[data-consent-banner]');

/** Records layout shifts and the moment the banner is added, from before the page loads. */
async function watchShifts(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: { t: number; v: number; input: boolean }[]; __bannerAt: number | null };
    w.__shifts = [];
    w.__bannerAt = null;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { startTime: number; value: number; hadRecentInput: boolean }[]) {
        w.__shifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput });
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new MutationObserver(() => {
      if (w.__bannerAt === null && document.querySelector('[data-consent-banner]')) w.__bannerAt = performance.now();
    }).observe(document, { childList: true, subtree: true });
  });
}

test('EU visitor: banner appears without moving the page; Reject → no tracker request', async ({ page }) => {
  await watchShifts(page);
  const log = await answerProbe(page, 'eu');
  await page.goto('/');
  await expect(banner(page)).toBeVisible({ timeout: 10_000 });
  await expect(banner(page).getByRole('button', { name: 'Accept' })).toBeVisible();

  // Equal weight: same size.
  const [reject, accept] = await Promise.all(
    ['Reject', 'Accept'].map((name) => banner(page).getByRole('button', { name }).boundingBox()),
  );
  expect(Math.abs(reject!.width - accept!.width)).toBeLessThanOrEqual(1);
  expect(reject!.height).toBe(accept!.height);

  // No layout shift from the banner (CLS stays 0).
  await page.waitForTimeout(500);
  const { shifts, bannerAt } = await page.evaluate(() => {
    const w = window as unknown as { __shifts: { t: number; v: number }[]; __bannerAt: number };
    return { shifts: w.__shifts, bannerAt: w.__bannerAt };
  });
  expect(bannerAt).not.toBeNull();
  expect(shifts.filter((s) => s.t >= bannerAt - 1).reduce((sum, s) => sum + s.v, 0)).toBe(0);

  await banner(page).getByRole('button', { name: 'Reject' }).click();
  await expect(banner(page)).toHaveCount(0);
  const cookies = await page.context().cookies();
  const consent = cookies.find((c) => c.name === 'sf_consent');
  expect(consent?.value).toBe('n');
  // At most 13 months.
  expect(consent!.expires * 1000 - Date.now()).toBeLessThanOrEqual(395 * 86_400_000);

  await page.mouse.wheel(0, 600);
  await hidePage(page);
  await page.waitForTimeout(500);
  expect(log.flushes).toHaveLength(0);

  // Next page load: nothing is fetched at all, not even the probe.
  log.any.length = 0;
  await page.goto('/chat');
  await settleIdle(page);
  await hidePage(page);
  await page.waitForTimeout(300);
  expect(log.any).toHaveLength(0);
  await expect(banner(page)).toHaveCount(0);
});

test('EU visitor: Accept → the tracker runs and flushes on hidden', async ({ page }) => {
  const log = await answerProbe(page, 'eu');
  await page.goto('/');
  await banner(page).getByRole('button', { name: 'Accept' }).click();
  await expect(banner(page)).toHaveCount(0);
  await hidePage(page);
  await expect.poll(() => log.flushes.length).toBe(1);
  expect(log.flushes[0].body).toMatchObject({ seq: 0 });
  expect(log.flushes[0].body.events[0]).toMatchObject({ type: 'pageview', path: '/' });
});

test('outside consent regions: no banner, tracker runs', async ({ page }) => {
  const log = await answerProbe(page, 'ok');
  await page.goto('/chat');
  await settleIdle(page);
  await expect(banner(page)).toHaveCount(0);
  await hidePage(page);
  await expect.poll(() => log.flushes.length).toBe(1);
  expect(log.flushes[0].body.events[0]).toMatchObject({ type: 'pageview', path: '/chat' });
});

test('"Privacy choices" in the footer reopens the banner; Reject stops the running tracker', async ({ page }) => {
  const log = await answerProbe(page, 'ok');
  await page.goto('/');
  await settleIdle(page);
  await page.locator('#site-footer').getByRole('link', { name: 'Privacy choices' }).click();
  await expect(banner(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(banner(page).getByRole('button', { name: 'Reject' })).toBeFocused();
  await banner(page).getByRole('button', { name: 'Reject' }).click();
  await hidePage(page);
  await page.waitForTimeout(500);
  expect(log.flushes).toHaveLength(0);
});

for (const [name, script] of [
  ['Global Privacy Control', () => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true })],
  ['Do Not Track', () => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' })],
] as const) {
  test(`${name} → no tracker request, no banner, even in the EU`, async ({ page }) => {
    await page.addInitScript(script);
    const log = await answerProbe(page, 'eu');
    await page.goto('/');
    await settleIdle(page);
    await page.mouse.wheel(0, 400);
    await hidePage(page);
    await page.waitForTimeout(300);
    expect(log.any).toHaveLength(0);
    await expect(banner(page)).toHaveCount(0);

    // "Privacy choices" just opens the privacy page: nothing is loaded.
    await page.locator('#site-footer').getByRole('link', { name: 'Privacy choices' }).click();
    await expect(page).toHaveURL(/\/privacy#rights$/);
    await expect(banner(page)).toHaveCount(0);
    expect(log.any).toHaveLength(0);
  });
}
