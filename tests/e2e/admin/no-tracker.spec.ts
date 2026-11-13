import { expect, test } from '@playwright/test';

import { answerProbe, hidePage, settleIdle } from '../support/tracker';

// Admins are not visitors: the tracker is never fetched on /admin/** (07-tracker.md).
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'w1366', 'path rule, width-independent');
});

test('no tracker request on /admin/sign-in, even where tracking would run', async ({ page }) => {
  const log = await answerProbe(page, 'ok');
  await page.goto('/admin/sign-in');
  await settleIdle(page);
  await page.mouse.wheel(0, 300);
  await hidePage(page);
  await page.waitForTimeout(300);
  expect(log.any).toHaveLength(0);
  await expect(page.locator('[data-consent-banner]')).toHaveCount(0);
});
