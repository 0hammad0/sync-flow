import { expect, test } from '@playwright/test';

// Public pages must fit every width from 320 px up: a page wider than the
// screen scrolls sideways on phones. The admin screens get the same check.
const PAGES = ['/', '/chat', '/send', '/receive', '/login', '/privacy', '/terms'];

for (const path of PAGES) {
  test(`${path} has no horizontal scroll`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
