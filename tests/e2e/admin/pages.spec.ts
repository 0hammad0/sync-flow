import { expect, test, type BrowserContext, type TestInfo } from '@playwright/test';

import { showTableFilters } from '../support/table-filters';

/*
 * Pages (phase 3 step 3.7). Spec: docs/admin/03-features/05-pages.md.
 * Runs at all 8 viewports (playwright.config.ts projects).
 *
 * Signed-in tests need an owner session cookie minted against a NON-production
 * Firebase project (see shell.spec.ts): E2E_ADMIN_SESSION. Without it they are
 * `fixme`. Data may be empty (tracking is new), so the tests accept either the
 * table rows or the empty state and check the shape, not the numbers.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const NO_SESSION_REASON = 'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator.';
const EMPTY = /^No (page views|entry pages|exit pages) (yet|in this range)\.$/;

const widthOf = (testInfo: TestInfo) => testInfo.project.use.viewport?.width ?? 1366;

async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

test.describe('signed out', () => {
  test('/admin/pages redirects to sign-in with next', async ({ request }) => {
    const response = await request.get('/admin/pages', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe(`/admin/sign-in?next=${encodeURIComponent('/admin/pages')}`);
  });
});

test.describe('signed in', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test('title, UTC note, mode switch and a table or an empty state', async ({ page, context, baseURL }, testInfo) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/pages?range=30d');
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
    await expect(page.getByText('Views and time per page. Days are in UTC.')).toBeVisible();
    await expect(page.getByText(EMPTY).or(page.locator('a[data-row-link], main ul[aria-label="Pages"] a').first())).toBeVisible();
    // Phones: the mode switch is in the "Filters" sheet (08-tables.md "< 640 px").
    await showTableFilters(page, testInfo);
    await expect(page.getByRole('radiogroup', { name: 'Which pages' }).filter({ visible: true })).toBeVisible();
  });

  test('no real room code or share token anywhere on the screen', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/pages?range=90d');
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/\/chat\/[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}\b/);
    expect(html).not.toMatch(/\/(share|send)\/[0-9a-f]{32}/);
  });

  test('mode and search live in the URL and survive a reload', async ({ page, context, baseURL }, testInfo) => {
    await signIn(context, baseURL!, OWNER!);
    const modes = page.getByRole('radiogroup', { name: 'Which pages' }).filter({ visible: true });
    await page.goto('/admin/pages?range=30d');
    await showTableFilters(page, testInfo);
    await modes.getByRole('radio').first().click();
    await expect(page).toHaveURL(/mode=entry/);
    await page.reload();
    await showTableFilters(page, testInfo);
    await expect(modes.getByRole('radio', { checked: true })).toHaveText(/Entry/);

    await page.goto('/admin/pages?mode=nope');
    await showTableFilters(page, testInfo);
    await expect(modes.getByRole('radio', { checked: true })).toHaveText(/All/);
  });

  test('an unknown ?path= shows "Unknown page." without a query', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/pages?path=%2Fchat%2FABCD2345');
    await expect(page.getByText('Unknown page.').filter({ visible: true })).toBeVisible();
  });

  test('row click opens the panel and sets ?path=; reload restores it; Esc closes it', async ({ page, context, baseURL }, testInfo) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/pages?range=90d');
    const row = page.locator('a[href*="path="]').filter({ visible: true }).first();
    test.skip((await row.count()) === 0, 'No page views in this environment.');
    await row.click();
    await expect(page).toHaveURL(/path=%2F/);
    await expect(page.getByText(/^Views per (day|hour)$/).filter({ visible: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(/^Views per (day|hour)$/).filter({ visible: true })).toBeVisible();
    // From 1280 px the panel is server-rendered, so it shows before hydration. Its Esc
    // listener starts in the same effect that focuses its title (PageDetailLayout.tsx):
    // wait for that focus, or the Esc lands before anything listens.
    if (widthOf(testInfo) >= 1280) await expect(page.locator('#page-detail-title')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/path=/);
    if (widthOf(testInfo) >= 1280) {
      await expect(page.locator('a[data-row-link]:focus'))
        .toHaveCount(1)
        .catch(async (error: Error) => {
          const focused = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160));
          throw new Error(`${error.message}\nfocused instead: ${focused}`);
        });
    }
  });

  test('no horizontal scroll', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/pages?range=90d');
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
