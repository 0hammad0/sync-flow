import { expect, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';

/**
 * Session seam for signed-in admin specs. The values are `__session` cookies
 * minted against the Firebase Auth EMULATOR by tests/e2e/support/seed-emulator.mjs
 * (CI job `e2e-signed-in`). Never a production session. Unset → specs `fixme`.
 */
export const SESSIONS = {
  owner: process.env.E2E_ADMIN_SESSION,
  moderator: process.env.E2E_MODERATOR_SESSION,
  viewer: process.env.E2E_VIEWER_SESSION,
  norole: process.env.E2E_NOROLE_SESSION,
} as const;

/** An IP with seeded analytics sessions (Danger zone, export). */
export const SUBJECT_IP = process.env.E2E_SUBJECT_IP;

export const needs = (name: string) => `Needs ${name}: a session cookie from the Firebase Auth emulator (seed-emulator.mjs).`;

export async function signIn(context: BrowserContext, baseURL: string, session: string) {
  await context.addCookies([{ name: '__session', value: session, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

export const widthOf = (testInfo: TestInfo) => testInfo.project.use.viewport?.width ?? 1366;
export const isTouch = (testInfo: TestInfo) => Boolean(testInfo.project.use.hasTouch);

/** ⌘K on macOS, Ctrl+K elsewhere (CommandPalette listens for both by platform). */
export const PALETTE_KEYS = process.platform === 'darwin' ? 'Meta+K' : 'Control+K';

const isActive = (target: Locator) => target.evaluate((el) => el === document.activeElement).catch(() => false);

/** Presses Tab (only Tab) until `target` has focus. Fails after `max` presses. */
export async function tabTo(page: Page, target: Locator, max = 120): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await isActive(target)) return;
    await page.keyboard.press('Tab');
  }
  if (await isActive(target)) return;
  const active = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 60)}"` : 'none';
  });
  throw new Error(`Tab never reached ${target} in ${max} presses (focus ended on ${active}).`);
}

/** Focused, matches :focus-visible, and draws a ring (outline or box-shadow). */
export async function expectFocusVisible(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  const ring = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      focusVisible: el.matches(':focus-visible'),
      outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
      shadow: s.boxShadow !== 'none',
    };
  });
  expect(ring.focusVisible, 'element matches :focus-visible').toBe(true);
  expect(ring.outline || ring.shadow, 'focus ring is drawn (outline or box-shadow)').toBe(true);
}

/** True when the focused element is inside `container`. */
export const focusInside = (container: Locator) => container.evaluate((el) => el.contains(document.activeElement));
