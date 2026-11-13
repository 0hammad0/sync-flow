import { expect, test } from '@playwright/test';

// Admin sign-in, sign-out and forbidden (docs/admin/03-features/01-auth.md).
// Runs at all 8 viewports (playwright.config.ts projects).

test.describe('/admin/sign-in', () => {
  test('renders the form with a labelled email field', async ({ page }) => {
    const res = await page.goto('/admin/sign-in');
    expect(res?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to admin' })).toBeVisible();
    const email = page.getByRole('textbox', { name: 'Email' });
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'email');
    await expect(email).toBeFocused();
    await expect(page.getByRole('button', { name: 'Send sign-in link' })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Back to site' })).toHaveAttribute('href', '/');
  });

  test('has no horizontal scroll', async ({ page }) => {
    await page.goto('/admin/sign-in');
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('validates an empty email without sending anything', async ({ page }) => {
    await page.goto('/admin/sign-in');
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    // Next's route announcer is also role="alert"; match ours by its text.
    await expect(page.getByRole('alert').filter({ hasText: 'Enter your email.' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true');
  });

  test('shows the "signed out on all devices" notice', async ({ page }) => {
    await page.goto('/admin/sign-in?notice=everywhere');
    await expect(page.getByRole('status').filter({ hasText: 'Signed out on all devices.' })).toBeVisible();
  });

  test('disables sending while offline', async ({ page, context }) => {
    await page.goto('/admin/sign-in');
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await expect(page.getByText('You are offline. Connect to send a link.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send sign-in link' })).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Send sign-in link' })).toBeEnabled();
  });

  test('a signed-out visit to /admin lands here with next', async ({ page }) => {
    await page.goto('/admin/files?type=chat');
    await expect(page).toHaveURL(/\/admin\/sign-in\?next=%2Fadmin%2Ffiles%3Ftype%3Dchat$/);
  });
});

// These need a real magic link (an email inbox) or a real Firebase session
// cookie, which this suite cannot create: there is no Auth emulator wiring in
// e2e and the session cookie is minted by Firebase from a fresh sign-in.
test.describe('needs a real signed-in session', () => {
  test.fixme('magic-link sign-in lands on next and writes one auth.sign_in row', async () => {
    // Needs: an inbox or the Firebase Auth emulator + emulator-aware /api/session.
  });

  test.fixme('an already signed-in admin opening /admin/sign-in goes straight to next', async () => {
    // Needs: a valid admin __session cookie.
  });

  test.fixme('a signed-in user without a role sees "This account isn’t an admin" and can sign out', async () => {
    // Needs: a valid no-role __session cookie, and the shell layout (merged separately).
  });

  test.fixme('sign out everywhere sends a second browser to sign-in on its next request', async () => {
    // Needs: two real sessions for one admin.
  });
});
