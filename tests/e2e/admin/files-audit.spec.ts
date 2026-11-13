import { expect, test, type BrowserContext } from '@playwright/test';

/*
 * Files & storage (phase 1 step 1.2) and Audit log (step 1.6).
 * Specs: docs/admin/03-features/09-files-and-storage.md, 11-audit-log.md.
 *
 * Signed-out tests need nothing. Signed-in tests need session cookies minted
 * against a NON-production Firebase project (see shell.spec.ts):
 *   E2E_ADMIN_SESSION      owner      (required for the signed-in tests)
 *   E2E_MODERATOR_SESSION  moderator  (optional)
 *   E2E_VIEWER_SESSION     viewer     (optional)
 * Without them those tests are `fixme`.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const MODERATOR = process.env.E2E_MODERATOR_SESSION;
const VIEWER = process.env.E2E_VIEWER_SESSION;
const NO_SESSION_REASON = 'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator.';
const FILE_ID = `f_${'A'.repeat(60)}`;

async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

test.describe('signed out', () => {
  for (const path of ['/admin/files', `/admin/files/${FILE_ID}`, '/admin/audit']) {
    test(`${path} redirects to sign-in with next`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toBe(`/admin/sign-in?next=${encodeURIComponent(path)}`);
    });
  }
});

test.describe('signed in: files', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test('shows storage and the files table, with opaque ids and no file names or tokens', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/files');
    await expect(page.getByRole('heading', { level: 1, name: 'Files & storage' })).toBeVisible();
    await expect(page.getByText('No file names.', { exact: false })).toBeVisible();

    const html = await page.content();
    // A share token is 32 hex chars; the old admin id was s_<token>.
    expect(html).not.toMatch(/\/admin\/files\/s_[0-9a-f]{32}/);
    expect(html).not.toMatch(/\/admin\/files\/c_[A-Z0-9]{8}_/);
    const hrefs = await page.locator('a[data-row-link]').evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
    for (const href of hrefs) expect(href).toMatch(/^\/admin\/files\/f_[A-Za-z0-9_-]+$/);
    // No download, preview or share link anywhere on the screen [D-4].
    await expect(page.locator('main img, main video, main audio, main iframe')).toHaveCount(0);
  });

  test('a row opens the drawer on soft navigation; a direct load renders the full page', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/files');
    const first = page.locator('a[data-row-link]').first();
    test.skip((await first.count()) === 0, 'No files in this environment.');
    const href = (await first.getAttribute('href'))!;
    await first.click();
    await expect(page).toHaveURL(href);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('never shown')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/admin\/files$/);

    await page.goto(href);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /file$/ })).toBeVisible();
  });

  test('an unknown or old-format id is a 404 in the shell', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/files/s_0123456789abcdef0123456789abcdef');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});

test.describe('signed in: audit', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test('lists entries read-only: no edit or delete control', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(edit|delete)\b/i })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /^Select/ })).toHaveCount(0);
  });

  test('a moderator sees the own-actions note and only their own rows', async ({ page, context, baseURL }) => {
    test.fixme(!MODERATOR, 'Needs E2E_MODERATOR_SESSION (moderator session cookie from the Auth emulator).');
    await signIn(context, baseURL!, MODERATOR!);
    await page.goto('/admin/audit?actor=someone-else');
    await expect(page.getByText('You see your own actions only.')).toBeVisible();
    await expect(page.getByPlaceholder('Exact target id…')).toHaveCount(0);
  });

  test('a viewer cannot open the audit log', async ({ page, context, baseURL }) => {
    test.fixme(!VIEWER, 'Needs E2E_VIEWER_SESSION (viewer session cookie from the Auth emulator).');
    await signIn(context, baseURL!, VIEWER!);
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toHaveCount(0);
  });
});
