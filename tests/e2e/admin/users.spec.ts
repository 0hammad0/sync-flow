import { expect, test, type BrowserContext } from '@playwright/test';

/*
 * Users screen (phase 1 step 1.4). Spec: docs/admin/03-features/13-users.md.
 *
 * Signed-in tests need an admin `__session` cookie from the Firebase Auth
 * emulator (same seam as shell.spec.ts):
 *   E2E_ADMIN_SESSION   owner session (required)
 *   E2E_ADMIN_UID       that owner's uid (for the "This is you" check, optional)
 *   E2E_VIEWER_SESSION  viewer session (optional)
 * Without them they are `fixme`. We never use a production session.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const OWNER_UID = process.env.E2E_ADMIN_UID;
const VIEWER = process.env.E2E_VIEWER_SESSION;
const NO_SESSION_REASON = 'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator.';

async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

test.describe('signed out', () => {
  test('/admin/users and a user detail redirect to sign-in', async ({ request }) => {
    const list = await request.get('/admin/users?filter=admins', { maxRedirects: 0 });
    expect(list.status()).toBe(307);
    expect(list.headers().location).toBe('/admin/sign-in?next=%2Fadmin%2Fusers%3Ffilter%3Dadmins');
    const detail = await request.get('/admin/users/uidAAAAAAAAAAAAAAAAAAAAAAAA1', { maxRedirects: 0 });
    expect(detail.status()).toBe(307);
  });
});

test.describe('signed in', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test('lists users, no horizontal scroll', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('admins filter lists the signed-in owner', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/users?filter=admins');
    await expect(page.getByRole('radio', { name: 'Admins' })).toBeChecked();
    await expect(page.getByText('This is you.').first()).toBeVisible();
  });

  test('your own detail page has no actions', async ({ page, context, baseURL }) => {
    test.skip(!OWNER_UID, 'Needs E2E_ADMIN_UID');
    await signIn(context, baseURL!, OWNER!);
    await page.goto(`/admin/users/${OWNER_UID}`);
    await expect(page.getByText(/This is you/)).toBeVisible();
    for (const name of ['Disable', 'Sign out everywhere', 'Set role']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
  });

  test('an unknown uid shows "This user no longer exists."', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/users/uidZZZZZZZZZZZZZZZZZZZZZZZZ9');
    await expect(page.getByText('This user no longer exists.')).toBeVisible();
  });
});

test.describe('viewer', () => {
  test.fixme(!VIEWER, 'Needs E2E_VIEWER_SESSION (viewer session cookie from the Auth emulator).');

  test('sees users but no account actions', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, VIEWER!);
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    await page.getByRole('link').filter({ hasText: '@' }).first().click();
    await expect(page.getByRole('button', { name: 'Set role' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Disable' })).toHaveCount(0);
  });
});
