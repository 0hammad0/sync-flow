import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

/*
 * Overview (phase 3, step 3.4). Spec: docs/admin/03-features/02-overview.md.
 *
 * Signed-out tests need nothing. Signed-in tests need E2E_ADMIN_SESSION (an
 * owner session cookie from the Firebase Auth emulator), like shell.spec.ts;
 * without it they are `fixme`. Tracking only went live on 2026-11-13, so the
 * data checks accept either the KPI cards or the "No visits in this range"
 * state: both are designed states, never an error.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const NO_SESSION_REASON =
  'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator (no e2e auth seam exists yet).';

const widthOf = (testInfo: TestInfo) => testInfo.project.use.viewport?.width ?? 1366;

async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('signed out', () => {
  test('/admin?range=30d keeps the range in next', async ({ request }) => {
    const response = await request.get('/admin?range=30d', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe('/admin/sign-in?next=%2Fadmin%3Frange%3D30d');
  });
});

test.describe('signed in', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
  });

  test('shows the KPIs (or the empty range state), the trend and 3 top lists', async ({ page }) => {
    await page.goto('/admin?range=30d');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByText('Days are in UTC.')).toBeVisible();

    const kpis = page.getByRole('link', { name: /^Visitors / });
    const empty = page.getByText('No visits in this range').first();
    await expect(kpis.or(empty)).toBeVisible();
    if (await kpis.isVisible()) {
      for (const label of ['Visitors', 'Sessions', 'Page views', 'Avg time', 'Bounce rate']) {
        await expect(page.getByRole('link', { name: new RegExp(`^${label} `) })).toHaveAttribute('href', /range=30d/);
      }
    }

    await expect(page.getByRole('heading', { name: 'Visitors over time' })).toBeVisible();
    for (const title of ['Top pages', 'Top countries', 'Top sources']) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }
  });

  test('a bad range falls back to 7 days with no error', async ({ page }) => {
    await page.goto('/admin?range=forever');
    await expect(page.getByRole('button', { name: /Date range: Last 7 days/ })).toBeVisible();
    await expect(page.getByText("Couldn't load")).toHaveCount(0);
  });

  test('the trend chart (Recharts) is not in the first route JS', async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'script') scripts.push(r.url());
    });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    const initial = [...scripts];
    // The plot chunk loads after the frame; the frame itself must not pull it in synchronously.
    expect(initial.some((u) => /recharts/i.test(u))).toBe(false);
  });

  test('"online now" polls every 60 s and stops while the tab is hidden', async ({ page }, testInfo) => {
    test.skip(widthOf(testInfo) < 1024, 'The top-bar count shows from 1024 px');
    await page.clock.install();
    let polls = 0;
    await page.route('**/api/admin/live?only=count', async (route) => {
      polls += 1;
      await route.fulfill({ json: { state: 'ok', data: { count: 3, at: new Date().toISOString() } } });
    });
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: '3 online', exact: true })).toBeVisible();
    const first = polls;
    await page.clock.runFor(60_000);
    await expect.poll(() => polls).toBe(first + 1);

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await page.clock.runFor(180_000);
    expect(polls).toBe(first + 1);
  });

  test('no horizontal scroll', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Visitors over time' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
