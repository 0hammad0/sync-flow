import { expect, test, type BrowserContext } from '@playwright/test';

/*
 * Clicks (phase 4 step 4.4). Spec: docs/admin/03-features/06-clicks.md.
 * Runs at all 8 viewports (playwright.config.ts projects).
 *
 * Signed-in tests need an owner session cookie minted against a NON-production
 * Firebase project (see shell.spec.ts): E2E_ADMIN_SESSION. Without it they are
 * `fixme`. Data may be empty, so the tests accept the ranking or an empty state.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const NO_SESSION_REASON = 'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator.';
const EMPTY = /^No (clicks recorded yet|clicks on .+ at this viewport)\.$/;

async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

test.describe('signed out', () => {
  test('/admin/clicks redirects to sign-in with next', async ({ request }) => {
    const response = await request.get('/admin/clicks', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe(`/admin/sign-in?next=${encodeURIComponent('/admin/clicks')}`);
  });
});

test.describe('signed in', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test('title, filters, consent note, and the ranking or an empty state; no horizontal scroll', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/clicks?range=30d');
    await expect(page.getByRole('heading', { level: 1, name: 'Clicks' })).toBeVisible();
    await expect(page.getByText('Where people click. Days are in UTC.')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Viewport' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'View', exact: true })).toBeVisible();
    await expect(page.getByText('Clicks from visitors without consent are not recorded.')).toBeVisible();
    await expect(page.getByText(EMPTY).or(page.getByRole('table'))).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('list view loads no map: no iframe, no canvas', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/clicks?range=30d&view=list');
    await expect(page.getByRole('heading', { level: 1, name: 'Clicks' })).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('viewport and view live in the URL; bad values fall back silently', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/clicks?range=30d');
    await page.getByRole('radiogroup', { name: 'Viewport' }).getByRole('radio', { name: 'Phone' }).click();
    await expect(page).toHaveURL(/vw=sm/);
    await page.reload();
    await expect(page.getByRole('radiogroup', { name: 'Viewport' }).getByRole('radio', { checked: true })).toHaveText('Phone');

    await page.goto('/admin/clicks?vw=xl&view=nope');
    await expect(page.getByRole('radiogroup', { name: 'Viewport' }).getByRole('radio', { checked: true })).toHaveText('Desktop');
    await expect(page.getByRole('radiogroup', { name: 'View', exact: true }).getByRole('radio', { checked: true })).toHaveText('List');
  });

  test('an unknown ?path= shows "Unknown page."', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/clicks?path=%2Fchat%2FABCD2345');
    await expect(page.getByText('Unknown page.')).toBeVisible();
  });

  test('a page that runs app logic is list only', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/clicks?path=%2Fchat%2F%5Bcode%5D&view=map');
    await expect(page.getByText('This page cannot be shown as a map. Use the list.')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('map view frames the page with ?sf_preview=1, inert, and the frame sends 0 tracker events', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    const trackerRequests: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/e') trackerRequests.push(r.method());
    });
    await page.goto('/admin/clicks?range=30d&path=%2F&view=map');
    const frame = page.locator('iframe[title="Preview of /"]');
    const empty = page.getByText(EMPTY);
    await expect(frame.or(empty)).toBeVisible({ timeout: 15_000 });
    test.skip((await frame.count()) === 0, 'No clicks in this environment.');
    await expect(frame).toHaveAttribute('src', '/?sf_preview=1');
    await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin allow-scripts');
    await expect(frame).toHaveAttribute('tabindex', '-1');
    await page.waitForTimeout(4_000); // past the loader's idle fallback
    expect(trackerRequests).toEqual([]);
  });
});
