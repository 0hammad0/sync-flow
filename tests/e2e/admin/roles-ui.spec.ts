import { expect, test } from '@playwright/test';

import { SESSIONS, needs, signIn } from '../support/admin-session';

/*
 * Forbidden-safe UI per role, on screens the other specs do not cover for
 * that role. Already covered elsewhere (not repeated here):
 *   viewer nav (no Audit log / Settings)       shell.spec.ts
 *   viewer users: no Set role / Disable         users.spec.ts
 *   viewer rooms: no Close room                 rooms.spec.ts
 *   viewer sessions: masked IPs, no Block/Export sessions.spec.ts
 *   viewer audit log refused                    files-audit.spec.ts
 *   viewer palette: no write commands           command-palette.spec.ts
 *   no-role on /admin: forbidden screen         auth.spec.ts
 *
 * Sessions come from the Auth emulator (support/seed-emulator.mjs, which
 * also seeds one active block on 192.0.2.44). Missing → `fixme`.
 */
const { viewer: VIEWER, moderator: MODERATOR, norole: NOROLE } = SESSIONS;
const SEEDED_BLOCK_IP = '192.0.2.44';

test.describe('viewer', () => {
  test.fixme(!VIEWER, needs('E2E_VIEWER_SESSION'));

  test('access control: blocks listed with masked values, no New block and no Unblock', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, VIEWER!);
    await page.goto('/admin/access');
    await expect(page.getByRole('heading', { level: 1, name: 'Access control' })).toBeVisible();
    await expect(page.getByText('192.0.2.•••').first()).toBeVisible();
    expect(await page.content()).not.toContain(SEEDED_BLOCK_IP);
    await expect(page.getByRole('button', { name: 'New block' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Unblock/ })).toHaveCount(0);
  });

  test('settings by URL: the in-shell 403, no settings form, roles or danger zone', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, VIEWER!);
    await page.goto('/admin/settings?section=danger');
    await expect(page.getByRole('heading', { level: 1, name: 'Only owners can see this page' })).toBeVisible();
    await expect(page.locator('.admin-shell')).toBeVisible();
    for (const name of ['Save', 'Add admin', 'Find data', 'Delete all', 'Export CSV']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(page.locator('#danger')).toHaveCount(0);
    await expect(page.locator('#roles')).toHaveCount(0);
  });

  test('no Export CSV on the analytics screens', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, VIEWER!);
    for (const path of ['/admin/pages?range=30d', '/admin/sources?range=30d', '/admin/geography?range=30d']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Export CSV' }), path).toHaveCount(0);
    }
  });
});

test.describe('moderator', () => {
  test.fixme(!MODERATOR, needs('E2E_MODERATOR_SESSION'));

  test('settings by URL: the in-shell 403', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, MODERATOR!);
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Only owners can see this page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add admin' })).toHaveCount(0);
    await expect(page.locator('#danger')).toHaveCount(0);
  });
});

test.describe('signed in, no role', () => {
  test.fixme(!NOROLE, needs('E2E_NOROLE_SESSION'));

  test('a deep link gets the forbidden screen, never the shell or the page', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, NOROLE!);
    await page.goto('/admin/settings?section=danger');
    await expect(page.getByRole('heading', { level: 1, name: 'This account isn’t an admin' })).toBeVisible();
    await expect(page.locator('.admin-shell')).toHaveCount(0);
    await expect(page.locator('#danger')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Find data' })).toHaveCount(0);
  });

  test('an admin route handler answers 403 JSON, not data', async ({ request }) => {
    const res = await request.get('/api/admin/export/sessions?range=7d&preview=1', {
      headers: { cookie: `__session=${NOROLE}` },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
    expect(res.headers()['content-type']).toContain('application/json');
  });
});
