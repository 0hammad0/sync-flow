import { expect, test, type BrowserContext } from '@playwright/test';

/*
 * Rooms screen (phase 1 step 1.3). Spec: docs/admin/03-features/12-rooms.md.
 *
 * Signed-in tests need an admin `__session` cookie from the Firebase Auth
 * emulator (same seam as shell.spec.ts):
 *   E2E_ADMIN_SESSION   owner session (required)
 *   E2E_VIEWER_SESSION  viewer session (optional)
 * Without them they are `fixme`. We never use a production session.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const VIEWER = process.env.E2E_VIEWER_SESSION;
const NO_SESSION_REASON = 'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator.';

async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

test.describe('signed out', () => {
  test('/admin/rooms redirects to sign-in and keeps the query in next', async ({ request }) => {
    const response = await request.get('/admin/rooms?status=history', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe('/admin/sign-in?next=%2Fadmin%2Frooms%3Fstatus%3Dhistory');
  });
});

test.describe('signed in', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test('lists rooms with counts only, no horizontal scroll', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/rooms');
    await expect(page.getByRole('heading', { level: 1, name: 'Rooms' })).toBeVisible();
    await expect(page.getByText('Message text is never shown.')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('History tab reads closed rooms', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/rooms?status=history');
    await expect(page.getByRole('radio', { name: 'History' })).toBeChecked();
    await expect(page.getByRole('heading', { level: 1, name: 'Rooms' })).toBeVisible();
  });

  test('an unknown code opens the sheet with "no longer exists" and no close button', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/rooms?code=ZZZZZZZZ');
    const sheet = page.getByRole('dialog', { name: 'Room ZZZZZZZZ' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('This room no longer exists. It expired or was closed.')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Close room' })).toHaveCount(0);
  });

  test('the page never shows a link into the chat or a download', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/rooms');
    await expect(page.locator('a[href^="/chat"], a[download], a[href*="r2.cloudflarestorage"]')).toHaveCount(0);
  });
});

test.describe('viewer', () => {
  test.fixme(!VIEWER, 'Needs E2E_VIEWER_SESSION (viewer session cookie from the Auth emulator).');

  test('sees rooms but no Close room button', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, VIEWER!);
    await page.goto('/admin/rooms');
    await expect(page.getByRole('heading', { level: 1, name: 'Rooms' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close room' })).toHaveCount(0);
  });
});
