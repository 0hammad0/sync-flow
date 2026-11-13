import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

/*
 * Admin shell (phase 0, step 0.11). Spec: docs/admin/02-design/03-layout-and-sidebar.md
 * and 04-responsive.md.
 *
 * Signed-out tests need nothing. Signed-in tests need a real `__session`
 * cookie for an admin, minted against a NON-production Firebase project
 * (the Auth emulator, with the server started with FIREBASE_AUTH_EMULATOR_HOST):
 *
 *   E2E_ADMIN_SESSION   session cookie of a user with role=owner   (required)
 *   E2E_VIEWER_SESSION  session cookie of a user with role=viewer  (optional)
 *
 * Without them the signed-in tests are `fixme`: this repo has no emulator
 * seam for e2e yet (no Java on the dev machine, no CI job), and we never
 * use a production session in tests.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const VIEWER = process.env.E2E_VIEWER_SESSION;
const NO_SESSION_REASON =
  'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator (no e2e auth seam exists yet).';

const widthOf = (testInfo: TestInfo) => testInfo.project.use.viewport?.width ?? 1366;
const isTouch = (testInfo: TestInfo) => Boolean(testInfo.project.use.hasTouch);

type Pin = 'pinned' | 'rail' | undefined;

/** 04-responsive.md "Sidebar default per viewport": left edge of the content column. */
function expectedContentLeft(pin: Pin, width: number): number {
  if (width < 768) return 0;
  const pinned = pin === 'pinned' ? width >= 1024 : pin === 'rail' ? false : width >= 1280;
  return pinned ? 248 : 64;
}

async function signIn(context: BrowserContext, baseURL: string, session: string, pin?: Pin) {
  await context.addCookies([
    { name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' },
    ...(pin ? [{ name: 'sf_admin_sidebar', value: pin, domain: 'localhost', path: '/admin', sameSite: 'Lax' as const }] : []),
  ]);
}

/** Sums layout-shift entries from the first paint on. */
async function trackLayoutShift(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[] & { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) w.__cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

const contentLeft = (page: Page) => page.locator('#admin-content').evaluate((el) => Math.round(el.getBoundingClientRect().left));

test.describe('signed out', () => {
  test('/admin redirects to /admin/sign-in?next=%2Fadmin', async ({ page, request }) => {
    const response = await request.get('/admin', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe('/admin/sign-in?next=%2Fadmin');

    const landed = await page.goto('/admin');
    expect(new URL(landed!.url()).pathname + new URL(landed!.url()).search).toBe('/admin/sign-in?next=%2Fadmin');
  });

  test('a deep link keeps its path and query in next', async ({ request }) => {
    const response = await request.get('/admin/files?type=chat', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe('/admin/sign-in?next=%2Fadmin%2Ffiles%3Ftype%3Dchat');
  });
});

test.describe('signed in', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  for (const pin of [undefined, 'rail', 'pinned'] as const) {
    test(`sidebar state from cookie ${pin ?? '(none)'}: right on first paint, no layout shift`, async ({ page, context, baseURL }, testInfo) => {
      await signIn(context, baseURL!, OWNER!, pin);
      await trackLayoutShift(page);
      await page.goto('/admin');
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-sidebar', pin ?? 'auto');

      const expected = expectedContentLeft(pin, widthOf(testInfo));
      expect(await contentLeft(page)).toBe(expected);
      await page.reload();
      expect(await contentLeft(page)).toBe(expected);
      expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBe(0);
    });
  }

  test('public header and footer are hidden', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin');
    await expect(page.locator('body > header')).toBeHidden();
    await expect(page.locator('#site-footer')).toBeHidden();
  });

  test('rail opens on hover after 150 ms as an overlay and closes after leaving', async ({ page, context, baseURL }, testInfo) => {
    test.skip(isTouch(testInfo) || widthOf(testInfo) < 768, 'hover-open is pointer-fine, ≥ 768 px only');
    await signIn(context, baseURL!, OWNER!, 'rail');
    await page.goto('/admin');
    const sidebar = page.locator('.admin-sidebar');
    const before = await contentLeft(page);

    await page.mouse.move(widthOf(testInfo) - 10, 400);
    await sidebar.hover({ position: { x: 32, y: 300 } });
    await expect(sidebar).toHaveAttribute('data-open', 'hover');
    await expect(page.getByRole('link', { name: 'Sessions' })).toBeVisible();
    expect(await contentLeft(page)).toBe(before); // overlay, does not push content

    await page.mouse.move(widthOf(testInfo) - 10, 400);
    await expect(sidebar).not.toHaveAttribute('data-open');
  });

  test('keyboard focus opens the rail', async ({ page, context, baseURL }, testInfo) => {
    test.skip(widthOf(testInfo) < 768, 'no rail under 768 px');
    await signIn(context, baseURL!, OWNER!, 'rail');
    await page.goto('/admin');
    await page.getByRole('link', { name: 'Overview' }).first().focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.admin-sidebar')).toHaveAttribute('data-open', 'focus');
  });

  test('⌘B / Ctrl+B toggles the pin, saves the cookie, and is ignored while typing', async ({ page, context, baseURL }, testInfo) => {
    test.skip(widthOf(testInfo) < 1024, 'pinning exists from 1024 px');
    await signIn(context, baseURL!, OWNER!, 'rail');
    await page.goto('/admin');
    const shell = page.locator('.admin-shell');

    await page.keyboard.press('Control+B');
    await expect(shell).toHaveAttribute('data-sidebar', 'pinned');
    expect(await contentLeft(page)).toBe(248);
    const cookie = (await context.cookies()).find((c) => c.name === 'sf_admin_sidebar');
    expect(cookie).toMatchObject({ value: 'pinned', path: '/admin', sameSite: 'Lax' });
    expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(364 * 24 * 3600);

    await page.reload();
    await expect(shell).toHaveAttribute('data-sidebar', 'pinned');

    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'probe';
      document.getElementById('admin-content')!.append(input);
    });
    await page.locator('#probe').focus();
    await page.keyboard.press('Control+B');
    await expect(shell).toHaveAttribute('data-sidebar', 'pinned');

    await page.locator('body').click({ position: { x: widthOf(testInfo) - 20, y: 300 } });
    await page.keyboard.press('Meta+B');
    await expect(shell).toHaveAttribute('data-sidebar', 'rail');
  });

  test('under 768 px the nav is a drawer: opens, traps focus, Esc closes and returns focus', async ({ page, context, baseURL }, testInfo) => {
    test.skip(widthOf(testInfo) >= 768, 'drawer is < 768 px only');
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin');
    await expect(page.locator('.admin-sidebar')).toBeHidden();

    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    await menuButton.click();
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Sessions' })).toBeVisible();
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
    expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menuButton).toBeFocused();
  });

  test('theme toggle uses the site theme (.dark + sf-theme)', async ({ page, context, baseURL }, testInfo) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin');
    if (widthOf(testInfo) < 768) await page.getByRole('button', { name: 'Open navigation' }).click();
    const toggle = page.getByRole('button', { name: 'Dark theme' }).last();
    const wasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await toggle.click();
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!wasDark);
    expect(await page.evaluate(() => localStorage.getItem('sf-theme'))).toBe(wasDark ? 'light' : 'dark');
  });

  test('account menu shows email, role and the sign-out actions', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin');
    await page.getByRole('button', { name: /^Account:/ }).filter({ visible: true }).first().click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText('Owner')).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Back to site' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible();
    await menu.getByRole('menuitem', { name: /Sign out everywhere/ }).click();
    await expect(page.getByRole('alertdialog', { name: 'Sign out everywhere?' })).toBeVisible();
  });

  test('an unknown admin URL shows the in-shell 404', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/does-not-exist');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.locator('.admin-shell')).toBeVisible();
  });

  test('a viewer does not see Audit log or Settings', async ({ page, context, baseURL }) => {
    test.fixme(!VIEWER, 'Needs E2E_VIEWER_SESSION (viewer session cookie from the Auth emulator).');
    await signIn(context, baseURL!, VIEWER!);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  });
});
