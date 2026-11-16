import { expect, test, type Page } from '@playwright/test';

import {
  PALETTE_KEYS,
  SESSIONS,
  SUBJECT_IP,
  expectFocusVisible,
  focusInside,
  isTouch,
  needs,
  signIn,
  tabTo,
} from '../support/admin-session';

/*
 * Keyboard only (phase 5 Definition of Done): every step below uses Tab,
 * Enter, Escape, arrows or typing, never a click. Each control reached shows
 * a visible focus ring, and focus goes back to the opener when a dialog closes.
 *
 * Desktop widths only (pointer-fine, like command-palette.spec.ts). Needs an
 * owner session from the Auth emulator (E2E_ADMIN_SESSION, seeded by
 * support/seed-emulator.mjs in CI job `e2e-signed-in`).
 */
const OWNER = SESSIONS.owner;

test.beforeEach(({}, testInfo) => {
  test.skip(isTouch(testInfo), 'keyboard flows: desktop widths');
});

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search and jump' });

/** A fresh IPv6 documentation address (2001:db8::/32) per run, already in normalised form. */
function freshDocIp(): string {
  return `2001:db8::${(0x1000 + Math.floor(Math.random() * 0xefff)).toString(16)}`;
}

test.describe('keyboard only', () => {
  test.fixme(!OWNER, needs('E2E_ADMIN_SESSION'));

  test('command palette: shortcut opens, ↓ moves, Enter navigates and closes', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    await page.keyboard.press(PALETTE_KEYS);
    const combobox = palette(page).getByRole('combobox');
    await expect(combobox).toBeFocused();
    const first = await combobox.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();

    await page.keyboard.press('ArrowDown');
    const next = await combobox.getAttribute('aria-activedescendant');
    expect(next).toBeTruthy();
    expect(next).not.toBe(first);
    await expect(page.locator(`[id="${next}"]`)).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Enter');
    await expect(palette(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/admin\/settings(\?|$)/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('block flow: New block → type, reason, Enter saves; Esc cancels; focus returns to New block', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/access');
    await expect(page.getByRole('heading', { level: 1, name: 'Access control' })).toBeVisible();

    const newBlock = page.getByRole('button', { name: 'New block' }).filter({ visible: true }).first();
    await tabTo(page, newBlock);
    await expectFocusVisible(newBlock);

    // Esc closes without saving and returns focus.
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'New block' });
    await expect(dialog).toBeVisible();
    expect(await focusInside(dialog)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(newBlock).toBeFocused();

    // Enter saves.
    const ip = freshDocIp();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    const value = dialog.getByRole('textbox', { name: 'Value', exact: true });
    await tabTo(page, value, 20);
    await expectFocusVisible(value);
    await page.keyboard.type(ip);
    const reason = dialog.getByRole('textbox', { name: 'Reason', exact: true });
    await tabTo(page, reason, 20);
    await page.keyboard.type('keyboard e2e');
    // Focus never left the dialog while tabbing.
    expect(await focusInside(dialog)).toBe(true);
    await page.keyboard.press('Enter');

    await expect(dialog).toBeHidden();
    await expect(newBlock).toBeFocused();
    await expect(page.getByText(ip).first()).toBeVisible();
  });

  test('Danger zone: Find data, Delete all dialog traps focus, typing enables confirm, Esc closes and returns focus', async ({ page, context, baseURL }) => {
    test.skip(!SUBJECT_IP, 'Needs E2E_SUBJECT_IP (an IP with seeded sessions).');
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/settings?section=danger');
    await expect(page.getByRole('heading', { level: 2, name: 'Danger zone' })).toBeVisible();

    const danger = page.locator('#danger');
    const subject = danger.getByRole('textbox', { name: 'IP address or user id' });
    await tabTo(page, subject);
    await expectFocusVisible(subject);
    await page.keyboard.type(SUBJECT_IP!);
    await page.keyboard.press('Enter'); // submits "Find data"
    await expect(danger.getByText(/^Found \d+ sessions? for/)).toBeVisible();

    const deleteAll = danger.getByRole('button', { name: 'Delete all' });
    await tabTo(page, deleteAll, 20);
    await expectFocusVisible(deleteAll);
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('alertdialog', { name: `Delete all analytics for ${SUBJECT_IP}?` });
    await expect(dialog).toBeVisible();
    const confirmInput = dialog.getByRole('textbox');
    await expect(confirmInput).toBeFocused();
    const confirm = dialog.getByRole('button', { name: 'Delete all' });
    await expect(confirm).toBeDisabled();
    await page.keyboard.type(SUBJECT_IP!);
    await expect(confirm).toBeEnabled();

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInside(dialog), `focus stays in the dialog after Tab ${i + 1}`).toBe(true);
    }

    // Not confirmed: the seeded data stays for the other specs.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteAll).toBeFocused();
  });

  test('export: Export CSV → dialog → Export downloads a CSV; focus returns to Export CSV', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await page.goto('/admin/sessions?range=7d');
    await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();

    const exportCsv = page.getByRole('button', { name: 'Export CSV' }).filter({ visible: true }).first();
    await tabTo(page, exportCsv);
    await expectFocusVisible(exportCsv);
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: /^Export (the first )?[\d,]+ sessions?\?$/ });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const exportButton = dialog.getByRole('button', { name: /^Export( first [\d,]+)?$/ });
    await tabTo(page, exportButton, 10);
    await expectFocusVisible(exportButton);

    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    await expect(dialog).toBeHidden();
    await expect(exportCsv).toBeFocused();
  });
});
