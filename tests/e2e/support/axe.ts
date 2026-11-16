import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.2 A/AA rules (axe tags). Best-practice rules are not part of the gate. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

/** Impacts that fail a test. `minor` is reported by axe but does not fail. */
const FAILING_IMPACTS = new Set(['moderate', 'serious', 'critical']);

type AxeOptions = {
  /** CSS selectors to leave out, e.g. a third-party or preview iframe. */
  exclude?: string[];
};

/**
 * Runs axe on the page as it is now and fails on any moderate, serious or
 * critical WCAG violation. The message lists rule, impact and the first
 * offending selectors, so a CI failure is readable without the trace.
 */
export async function expectNoAxeViolations(page: Page, label: string, options: AxeOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  const failing = violations
    .filter((v) => v.impact && FAILING_IMPACTS.has(v.impact))
    .map((v) => {
      const targets = v.nodes
        .slice(0, 5)
        .map((n) => n.target.join(' '))
        .join(' | ');
      return `${v.id} (${v.impact}): ${v.help} [${v.nodes.length} node(s): ${targets}]`;
    });
  expect(failing, `axe violations on ${label}`).toEqual([]);
}
