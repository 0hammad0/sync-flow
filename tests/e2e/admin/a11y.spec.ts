import { expect, test, type Page } from '@playwright/test';

import { PALETTE_KEYS, SESSIONS, SUBJECT_IP, isTouch, needs, signIn } from '../support/admin-session';
import { expectNoAxeViolations } from '../support/axe';

/*
 * axe (WCAG 2.2 A/AA) on the phase 4–5 admin screens, at all 8 viewports
 * (playwright.config.ts projects), light and dark. Fails on moderate,
 * serious and critical violations (support/axe.ts).
 *
 * Needs an owner session from the Auth emulator (E2E_ADMIN_SESSION, CI job
 * `e2e-signed-in`, seeded by support/seed-emulator.mjs). Without it: `fixme`.
 */
const OWNER = SESSIONS.owner;
const SCHEMES = ['light', 'dark'] as const;

/** Animations off, so axe never measures a dialog mid-fade. */
async function prepare(page: Page, scheme: (typeof SCHEMES)[number]) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
}

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search and jump' });

test.describe('axe: clicks', () => {
  test.fixme(!OWNER, needs('E2E_ADMIN_SESSION'));

  for (const scheme of SCHEMES) {
    test(`/admin/clicks list (${scheme})`, async ({ page, context, baseURL }) => {
      await signIn(context, baseURL!, OWNER!);
      await prepare(page, scheme);
      await page.goto('/admin/clicks?range=30d&view=list');
      await expect(page.getByRole('heading', { level: 1, name: 'Clicks' })).toBeVisible();
      await expect(page.getByRole('radiogroup', { name: 'View' })).toBeVisible();
      await expectNoAxeViolations(page, `/admin/clicks list, ${scheme}`);
    });
  }

  test('/admin/clicks map view (controls; the preview frame is excluded)', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await prepare(page, 'light');
    await page.goto('/admin/clicks?range=30d&path=%2F&view=map');
    await expect(page.getByRole('heading', { level: 1, name: 'Clicks' })).toBeVisible();
    // The frame is the public page itself (inert, tabindex -1); it is covered by the public specs.
    await expectNoAxeViolations(page, '/admin/clicks map', { exclude: ['iframe'] });
  });
});

test.describe('axe: settings', () => {
  test.fixme(!OWNER, needs('E2E_ADMIN_SESSION'));

  for (const scheme of SCHEMES) {
    test(`/admin/settings, all sections (${scheme})`, async ({ page, context, baseURL }) => {
      await signIn(context, baseURL!, OWNER!);
      await prepare(page, scheme);
      await page.goto('/admin/settings');
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      for (const name of ['Tracking', 'Retention', 'Roles', 'Danger zone']) {
        await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
      }
      await expectNoAxeViolations(page, `/admin/settings, ${scheme}`);
    });
  }

  test('Roles: the Add admin dialog', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, OWNER!);
    await prepare(page, 'light');
    await page.goto('/admin/settings?section=roles');
    await page.getByRole('button', { name: 'Add admin' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Add an admin?' })).toBeVisible();
    await expectNoAxeViolations(page, 'Add admin dialog');
  });

  test('Danger zone: found data, then the delete confirm dialog', async ({ page, context, baseURL }) => {
    test.skip(!SUBJECT_IP, 'Needs E2E_SUBJECT_IP (an IP with seeded sessions).');
    await signIn(context, baseURL!, OWNER!);
    await prepare(page, 'light');
    await page.goto('/admin/settings?section=danger');
    await page.getByRole('textbox', { name: 'IP address or user id' }).fill(SUBJECT_IP!);
    await page.getByRole('button', { name: 'Find data' }).click();
    await expect(page.getByText(/^Found \d+ sessions? for/)).toBeVisible();
    await expectNoAxeViolations(page, 'Danger zone preview');

    await page.getByRole('button', { name: 'Delete all' }).click();
    await expect(page.getByRole('alertdialog', { name: `Delete all analytics for ${SUBJECT_IP}?` })).toBeVisible();
    await expectNoAxeViolations(page, 'Danger zone delete dialog');
    // Nothing is deleted: the dialog is closed without confirming.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});

test.describe('axe: command palette', () => {
  test.fixme(!OWNER, needs('E2E_ADMIN_SESSION'));

  for (const scheme of SCHEMES) {
    test(`open, pages list and an IP result (${scheme})`, async ({ page, context, baseURL }, testInfo) => {
      await signIn(context, baseURL!, OWNER!);
      await prepare(page, scheme);
      await page.goto('/admin');
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
      if (isTouch(testInfo)) {
        await page.getByRole('button', { name: 'Search and jump' }).filter({ visible: true }).first().tap();
      } else {
        await page.keyboard.press(PALETTE_KEYS);
      }
      await expect(palette(page).getByRole('combobox')).toBeVisible();
      await expect(palette(page).getByRole('group', { name: 'Pages' })).toBeVisible();
      await expectNoAxeViolations(page, `command palette, ${scheme}`);

      await palette(page).getByRole('combobox').fill('203.0.113.7');
      await expect(palette(page).getByRole('group', { name: 'IP address' })).toBeVisible();
      await expectNoAxeViolations(page, `command palette IP results, ${scheme}`);
    });
  }
});
