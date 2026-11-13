import { expect, test, type BrowserContext } from '@playwright/test';

/*
 * Sessions screen (phase 3 step 3.6). Spec: docs/admin/03-features/04-sessions.md.
 *
 * Signed-in tests need an admin `__session` cookie from the Firebase Auth
 * emulator (same seam as users.spec.ts):
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
  test('/admin/sessions and a session detail redirect to sign-in', async ({ request }) => {
    const list = await request.get('/admin/sessions?device=mobile', { maxRedirects: 0 });
    expect(list.status()).toBe(307);
    expect(list.headers().location).toBe('/admin/sign-in?next=%2Fadmin%2Fsessions%3Fdevice%3Dmobile');
    const detail = await request.get(`/admin/sessions/${'a'.repeat(32)}`, { maxRedirects: 0 });
    expect(detail.status()).toBe(307);
  });
});

test.describe('signed in', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test('filter and range in the URL survive reload and the back button', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/sessions?range=30d&device=mobile');
    await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
    const device = page.getByRole('combobox', { name: 'Device' });
    await expect(device).toHaveText(/Mobile/);

    await page.reload();
    await expect(device).toHaveText(/Mobile/);
    expect(new URL(page.url()).searchParams.get('range')).toBe('30d');

    // Picking a country drops the device (one filter at a time) and pushes a history entry.
    await page.getByRole('combobox', { name: 'Country' }).click();
    await page.getByRole('option', { name: 'Pakistan (PK)' }).click();
    await expect(page).toHaveURL(/country=PK/);
    expect(new URL(page.url()).searchParams.get('device')).toBeNull();

    await page.goBack();
    await expect(page).toHaveURL(/device=mobile/);
    await expect(device).toHaveText(/Mobile/);
  });

  test('a hand-made URL with two filters keeps the first and says so', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/sessions?country=PK&device=mobile');
    await expect(page.getByText(/One filter works at a time/)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Device' })).toHaveText(/All devices/);
  });

  test('320 px: no horizontal scroll', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/admin/sessions');
    await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a bad session id is a 404 page; an unknown one says it may be older than 90 days', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/sessions/not-a-session');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await page.goto(`/admin/sessions/${'0'.repeat(32)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Session not found.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to sessions' })).toBeVisible();
  });
});

test.describe('viewer', () => {
  test.fixme(!VIEWER, 'Needs E2E_VIEWER_SESSION (viewer session cookie from the Auth emulator).');

  test('sees masked IPs only and no Block or Export', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, VIEWER!);
    await page.goto('/admin/sessions?range=90d');
    await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
    const html = await page.content();
    // Every IPv4 in the page is masked (203.0.113.•••); no full dotted quad in a mono IP cell.
    expect(html).not.toMatch(/aria-label="Copy IP /);
    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Actions for session/ })).toHaveCount(0);
  });
});
