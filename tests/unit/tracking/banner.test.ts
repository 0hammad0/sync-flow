// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONSENT_MAX_AGE_S } from '@/features/tracking/cookies';

type Banner = typeof import('@/features/tracking/client/banner');

async function fresh(): Promise<Banner> {
  vi.resetModules();
  return import('@/features/tracking/client/banner');
}

const box = () => document.querySelector<HTMLElement>('[data-consent-banner]');
const button = (choice: 'y' | 'n') => box()!.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)!;

beforeEach(() => {
  document.body.innerHTML = '<main>page</main>';
  document.cookie = 'sf_consent=; Max-Age=0; Path=/';
});

afterEach(() => vi.restoreAllMocks());

describe('consent banner', () => {
  it('Accept and Reject have equal weight: same element, same style, nothing pre-selected', async () => {
    const { ask } = await fresh();
    void ask();
    const [reject, accept] = [button('n'), button('y')];
    expect(reject.textContent).toBe('Reject');
    expect(accept.textContent).toBe('Accept');
    expect(reject.tagName).toBe(accept.tagName);
    expect(reject.getAttribute('style')).toBe(accept.getAttribute('style'));
    expect(box()!.querySelectorAll('input, [aria-pressed="true"], [aria-checked="true"]')).toHaveLength(0);
  });

  it('is a fixed-position region (never moves the page) with a link to the policy', async () => {
    const { ask } = await fresh();
    void ask();
    const el = box()!;
    expect(el.style.position).toBe('fixed');
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('Privacy choices');
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/privacy#rights');
    expect(el.parentElement).toBe(document.body);
  });

  it('does not steal focus when it opens by itself; focuses its first button from the footer link', async () => {
    const { ask } = await fresh();
    void ask();
    expect(document.activeElement).toBe(document.body);
    void ask(true);
    expect(document.activeElement).toBe(button('n'));
    expect(document.querySelectorAll('[data-consent-banner]')).toHaveLength(1);
  });

  it.each([
    ['y', 'Accept'],
    ['n', 'Reject'],
  ] as const)('%s (%s): saves the choice for at most 13 months and removes the banner', async (choice, label) => {
    const { ask } = await fresh();
    const writes: string[] = [];
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
    vi.spyOn(document, 'cookie', 'set').mockImplementation((v: string) => {
      writes.push(v);
      desc.set!.call(document, v);
    });
    const result = ask();
    expect(button(choice).textContent).toBe(label);
    button(choice).click();
    expect(await result).toBe(choice);
    expect(box()).toBeNull();
    expect(writes).toEqual([`sf_consent=${choice}; Max-Age=${CONSENT_MAX_AGE_S}; Path=/; SameSite=Lax`]);
    expect(CONSENT_MAX_AGE_S).toBeLessThanOrEqual(395 * 86_400); // CNIL: 13 months
  });
});
