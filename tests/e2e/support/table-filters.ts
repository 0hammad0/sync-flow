import { expect, type Page, type TestInfo } from '@playwright/test';

import { widthOf } from './admin-session';

/**
 * Under 640 px the DataTable toolbar moves its filters (segmented controls,
 * selects) into a "Filters" bottom sheet (docs/admin/02-design/08-tables.md,
 * "< 640 px"; src/shared/ui/data-table/Toolbar.tsx). The inline copy is
 * `display: none` there, so role queries find the controls only while the
 * sheet is open. Opens it on phones; does nothing from 640 px or when it is
 * already open. Retries the tap, since one sent before hydration is lost.
 */
export async function showTableFilters(page: Page, testInfo: TestInfo): Promise<void> {
  if (widthOf(testInfo) >= 640) return;
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await expect(async () => {
    if (!(await sheet.isVisible())) await page.getByRole('button', { name: /^Filters/ }).click({ timeout: 1_000 });
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}
