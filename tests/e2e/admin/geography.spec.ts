import { expect, test, type BrowserContext, type TestInfo } from '@playwright/test';

/*
 * Geography (phase 3 step 3.8). Spec: docs/admin/03-features/07-geography.md.
 * Runs at all 8 viewports (playwright.config.ts projects).
 *
 * Signed-in tests need an owner session cookie minted against a NON-production
 * Firebase project (see shell.spec.ts): E2E_ADMIN_SESSION. Without it they are
 * `fixme`. Data may be empty (tracking is new), so the tests accept either the
 * table rows or the empty state and check the shape, not the numbers.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const NO_SESSION_REASON = 'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator.';

const widthOf = (testInfo: TestInfo) => testInfo.project.use.viewport?.width ?? 1366;

async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

test.describe('signed out', () => {
  test('/admin/geography redirects to sign-in with next', async ({ request }) => {
    const response = await request.get('/admin/geography', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe(`/admin/sign-in?next=${encodeURIComponent('/admin/geography')}`);
  });
});

test.describe('signed in', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test('world level: title, location note, breadcrumb and a table or an empty state', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/geography?range=30d');
    await expect(page.getByRole('heading', { level: 1, name: 'Geography' })).toBeVisible();
    await expect(page.getByText('Location is approximate.')).toBeVisible();
    const crumbs = page.getByRole('navigation', { name: 'Location level' });
    await expect(crumbs.getByText('All countries')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(/^(No locations yet|No visits in this range)$/).or(page.locator('a[data-row-link], main ul[aria-label="Countries"] a').first())).toBeVisible();
  });

  test('no horizontal scroll', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/geography?range=90d');
    await expect(page.getByRole('heading', { level: 1, name: 'Geography' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('drill by URL, back one level, and a bad country falls back silently', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/geography?range=7d&country=PK&region=PB');
    const crumbs = page.getByRole('navigation', { name: 'Location level' });
    await expect(crumbs.getByRole('link', { name: 'Pakistan' })).toBeVisible();
    await expect(crumbs.getByText('PB')).toHaveAttribute('aria-current', 'page');

    await page.getByRole('link', { name: 'Back to Pakistan' }).click();
    await expect(page).toHaveURL(/\/admin\/geography\?range=7d&country=PK$/);
    await expect(crumbs.getByText('Pakistan')).toHaveAttribute('aria-current', 'page');

    await page.goto('/admin/geography?country=XX&region=PB');
    await expect(crumbs.getByText('All countries')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /^Back to/ })).toHaveCount(0);
  });

  test('a country row drills to its regions', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/geography?range=90d');
    const row = page.locator('a[href*="country="]').first();
    test.skip((await row.count()) === 0, 'No located visits in this environment.');
    await row.click();
    await expect(page).toHaveURL(/country=[A-Z]{2}/);
    await expect(page.getByRole('navigation', { name: 'Location level' }).getByRole('link', { name: 'All countries' })).toBeVisible();
  });

  test('phones: map closed and its chunk not fetched until "Show map"', async ({ page, context, baseURL }, testInfo) => {
    test.skip(widthOf(testInfo) >= 640, 'phone layout only');
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/geography?range=90d');
    const show = page.getByRole('button', { name: 'Show map' });
    test.skip((await show.count()) === 0, 'No located visits: the map panel is not shown.');
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    await page.waitForLoadState('networkidle');
    // Chunk names are hashed: the map chunk is the script fetched on the click.
    const chunk = page.waitForRequest((r) => r.resourceType() === 'script');
    await show.click();
    await chunk;
    await expect(page).toHaveURL(/view=map/);
    await expect(page.getByRole('button', { name: 'Hide map' })).toHaveAttribute('aria-expanded', 'true');
  });
});
