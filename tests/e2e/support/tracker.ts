import type { Page, Request } from '@playwright/test';

/**
 * Tracker e2e helpers. The local server has no Firebase credentials, so its
 * `GET /api/e` would always answer "off" (fail closed). Tests answer the
 * region probe themselves; flushes (POST) go to the real route (always 204)
 * and are recorded from the request log.
 */

export type TrackerLog = {
  probes: Request[];
  flushes: { body: { sid: string; seq: number; final?: boolean; events: { type: string }[] } }[];
  any: Request[];
};

export async function answerProbe(page: Page, region: 'eu' | 'ok' | 'off'): Promise<TrackerLog> {
  const log: TrackerLog = { probes: [], flushes: [], any: [] };
  page.on('request', (request) => {
    if (new URL(request.url()).pathname !== '/api/e') return;
    log.any.push(request);
    if (request.method() === 'POST') log.flushes.push({ body: JSON.parse(request.postData() ?? '{}') });
  });
  await page.route('**/api/e', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    log.probes.push(route.request());
    await route.fulfill({
      status: 204,
      headers: { 'cache-control': 'no-store', 'set-cookie': `sf_cr=${region}; Max-Age=86400; Path=/; SameSite=Lax` },
    });
  });
  return log;
}

/** Makes the page report "hidden" and fires visibilitychange (what a tab switch does). */
export async function hidePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Waits until the loader's idle callback has had every chance to run (idle fallback is 2 s). */
export async function settleIdle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2_500);
}
