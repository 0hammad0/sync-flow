import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

/*
 * Command palette (phase 5, step 5.1). Spec: docs/admin/03-features/16-command-palette.md.
 *
 * Same session seam as shell.spec.ts: signed-in tests need a real `__session`
 * cookie minted against a NON-production Firebase project (Auth emulator):
 *   E2E_ADMIN_SESSION   owner   (required)
 *   E2E_VIEWER_SESSION  viewer  (optional, for the role filter)
 * Without them the tests are `fixme`. None of these searches reads Firestore:
 * an IP query only builds links, so no seeded data is needed.
 */
const OWNER = process.env.E2E_ADMIN_SESSION;
const VIEWER = process.env.E2E_VIEWER_SESSION;
const NO_SESSION_REASON =
  'Needs E2E_ADMIN_SESSION: an admin session cookie from the Firebase Auth emulator (no e2e auth seam exists yet).';

const widthOf = (testInfo: TestInfo) => testInfo.project.use.viewport?.width ?? 1366;
const isTouch = (testInfo: TestInfo) => Boolean(testInfo.project.use.hasTouch);

async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search and jump' });
const combobox = (page: Page) => palette(page).getByRole('combobox');

/**
 * The ⌘K and `/` listeners attach on hydration, after `load`: a key pressed
 * earlier is lost (CI: Ctrl+K sent 19 ms after load, palette never opened).
 * The trigger gets `aria-keyshortcuts` in the same effect that attaches them.
 */
async function shortcutsReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Search and jump' })).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
}

async function openWithKeys(page: Page) {
  await shortcutsReady(page);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(combobox(page)).toBeFocused();
}

test.describe('command palette', () => {
  test.fixme(!OWNER, NO_SESSION_REASON);

  test('not in the DOM until opened; ⌘K / Ctrl+K opens it, Esc closes and returns focus', async ({ page, context, baseURL }, testInfo) => {
    test.skip(isTouch(testInfo), 'keyboard shortcut: desktop widths');
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/sessions');
    await expect(page.locator('[data-command-palette]')).toHaveCount(0);

    const trigger = page.getByRole('button', { name: 'Search and jump' });
    await trigger.focus();
    await openWithKeys(page);
    await expect(palette(page).getByRole('group', { name: 'Pages' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('pages filter as you type and Enter navigates', async ({ page, context, baseURL }, testInfo) => {
    test.skip(isTouch(testInfo), 'keyboard flow: desktop widths');
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin');
    await openWithKeys(page);
    await page.keyboard.type('sour');
    await expect(palette(page).getByRole('option').first()).toContainText('Sources');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/sources$/);
    await expect(palette(page)).toHaveCount(0);
  });

  test('↑/↓ wrap and Tab stays in the input', async ({ page, context, baseURL }, testInfo) => {
    test.skip(isTouch(testInfo), 'keyboard flow: desktop widths');
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin');
    await openWithKeys(page);
    const active = () => combobox(page).getAttribute('aria-activedescendant');
    const first = await active();
    await page.keyboard.press('ArrowUp');
    expect(await active()).not.toBe(first);
    await page.keyboard.press('ArrowDown');
    expect(await active()).toBe(first);
    await page.keyboard.press('Tab');
    await expect(combobox(page)).toBeFocused();
  });

  test('IP search: server group with the sessions link and the Block action for an owner', async ({ page, context, baseURL }, testInfo) => {
    test.skip(isTouch(testInfo), 'keyboard flow: desktop widths');
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin');
    await openWithKeys(page);
    await page.keyboard.type('203.0.113.7');
    const group = palette(page).getByRole('group', { name: 'IP address' });
    await expect(group.getByRole('option', { name: /Sessions from 203\.0\.113\.7/ })).toBeVisible();
    await expect(group.getByRole('option', { name: /Block 203\.0\.113\.7/ })).toBeVisible();

    // The Block action opens the normal dialog, prefilled. Nothing is blocked from the palette.
    await group.getByRole('option', { name: /Block 203\.0\.113\.7/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New block' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox').first()).toHaveValue('203.0.113.7');
  });

  test('`/` opens the palette on a page without a search box, and focuses the search box where there is one', async ({ page, context, baseURL }, testInfo) => {
    test.skip(isTouch(testInfo), 'keyboard shortcut: desktop widths');
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin');
    await shortcutsReady(page);
    await page.locator('body').press('/');
    await expect(combobox(page)).toBeFocused();
    await page.keyboard.press('Escape');

    await page.goto('/admin/access');
    await shortcutsReady(page);
    await page.locator('body').press('/');
    await expect(page.locator('#admin-content input[type="search"]')).toBeFocused();
    await expect(palette(page)).toHaveCount(0);
  });

  test('touch: the top-bar button opens a full-screen sheet with Cancel', async ({ page, context, baseURL }, testInfo) => {
    test.skip(!isTouch(testInfo), 'touch widths only');
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin');
    await shortcutsReady(page);
    await page.getByRole('button', { name: 'Search and jump' }).tap();
    await expect(combobox(page)).toBeVisible();
    if (widthOf(testInfo) < 640) {
      // The sheet opens with a 180 ms scale(0.96 → 1) entrance: measure once it settles.
      await expect
        .poll(async () => Math.round((await palette(page).boundingBox())?.width ?? 0))
        .toBe(widthOf(testInfo));
      await palette(page).getByRole('button', { name: 'Cancel' }).tap();
      await expect(palette(page)).toHaveCount(0);
    }
  });
});

test.describe('command palette, viewer', () => {
  test.fixme(!VIEWER, 'Needs E2E_VIEWER_SESSION (viewer session from the Auth emulator).');

  test('never shows Settings, Audit log, New block or an IP group', async ({ page, context, baseURL }, testInfo) => {
    test.skip(isTouch(testInfo), 'keyboard flow: desktop widths');
    await signIn(context, baseURL!, VIEWER!);
    await page.goto('/admin');
    await openWithKeys(page);
    const list = palette(page).getByRole('listbox');
    await expect(list).not.toContainText('Settings');
    await expect(list).not.toContainText('Audit log');
    await expect(list).not.toContainText('New block');
    await page.keyboard.type('203.0.113.7');
    await page.waitForTimeout(600); // debounce + server round trip
    await expect(palette(page).getByRole('group', { name: 'IP address' })).toHaveCount(0);
  });
});
