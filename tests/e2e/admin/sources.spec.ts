import { expect, test, type BrowserContext, type TestInfo } from '@playwright/test';

/*
 * Sources (phase 3 step 3.9). Spec: docs/admin/03-features/08-sources.md.
 * Runs at all 8 viewports (playwright.config.ts projects).
 *
 * Signed-in tests need an owner session cookie minted against a NON-production
 * Firebase project (see shell.spec.ts): E2E_ADMIN_SESSION. Without it they are
 * `fixme`. Data may be empty (tracking is new), so the tests check the shape,
 * not the numbers.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const NO_SESSION_REASON = 'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator.';
const EMPTY = /^No (visits yet|visits in this range|UTM tags in this range)\.$/;

const widthOf = (testInfo: TestInfo) => testInfo.project.use.viewport?.width ?? 1366;

async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

test.describe('signed out', () => {
  test('/admin/sources redirects to sign-in with next', async ({ request }) => {
    const response = await request.get('/admin/sources', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe(`/admin/sign-in?next=${encodeURIComponent('/admin/sources')}`);
  });
});

test.describe('signed in', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test('title and a table or an empty state on every tab', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    for (const tab of ['referrers', 'utm', 'devices', 'browsers', 'os']) {
      await page.goto(`/admin/sources?range=30d&tab=${tab}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Sources' })).toBeVisible();
      await expect(page.getByText(EMPTY).or(page.locator('main table tbody tr, main ul li').first())).toBeVisible();
    }
  });

  test('tab and UTM field live in the URL; unknown values fall back silently', async ({ page, context, baseURL }, testInfo) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/sources?range=7d');
    if (widthOf(testInfo) >= 640) {
      await page.getByRole('tab', { name: 'UTM' }).click();
      await expect(page).toHaveURL(/tab=utm/);
      await expect(page).toHaveURL(/range=7d/);
      await page.getByRole('radio', { name: 'Medium' }).click();
      await expect(page).toHaveURL(/utm=medium/);
      await page.reload();
      await expect(page.getByRole('tab', { name: 'UTM' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('radio', { name: 'Medium' })).toBeChecked();
    }
    await page.goto('/admin/sources?tab=nope&utm=nope');
    await expect(page.getByRole('heading', { level: 1, name: 'Sources' })).toBeVisible();
    if (widthOf(testInfo) >= 640) await expect(page.getByRole('tab', { name: 'Referrers' })).toHaveAttribute('aria-selected', 'true');
  });

  test('phones get a tab select, not a tab list', async ({ page, context, baseURL }, testInfo) => {
    test.skip(widthOf(testInfo) >= 640, 'phone layout only');
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/sources');
    await expect(page.getByRole('tablist', { name: 'Sources' })).toBeHidden();
    await expect(page.getByRole('combobox', { name: 'Show' })).toBeVisible();
  });

  test('a referrer row opens its entry pages', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/sources?range=30d');
    const row = page.locator('a[href*="host="]').filter({ visible: true }).first();
    test.skip((await row.count()) === 0, 'No visits in this environment.');
    await row.click();
    await expect(page).toHaveURL(/host=/);
    await expect(page.getByRole('heading', { name: /^Entry pages (from|of direct visits)/ })).toBeVisible();
  });

  test('no horizontal scroll', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/sources?range=90d&tab=devices');
    await expect(page.getByRole('heading', { level: 1, name: 'Sources' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
