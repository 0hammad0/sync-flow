import { CONSENT_COOKIE, CONSENT_MAX_AGE_S, type Choice } from '../cookies';

/**
 * Consent banner (mode A). Plain DOM, own chunk, loaded only when a visitor
 * in the EU/EEA/UK has not chosen yet, or when someone opens "Privacy
 * choices" in the footer. Inline styles on the theme's CSS variables, so the
 * public stylesheet does not grow.
 *
 * - "Reject" and "Accept" look the same and are the same size. Nothing is
 *   pre-selected and nothing runs until one is clicked.
 * - `position: fixed` and inserted after the page is idle: it covers part of
 *   the page but never moves it (no layout shift, CLS stays 0).
 * - A non-modal region: it does not trap or steal focus when it opens by
 *   itself; opened from the footer link, focus moves to its first button.
 */

let pending: Promise<Choice> | null = null;

/** Stores the choice in a first-party cookie for 390 days (under the 13-month limit). */
export function saveChoice(choice: Choice): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`;
}

const BUTTON =
  'flex:1;min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--edge-strong);' +
  'background:var(--surface-2);color:var(--fg);font:inherit;font-weight:600;cursor:pointer';

/** Shows the banner (once) and resolves with the visitor's choice, already saved. */
export function ask(focus = false): Promise<Choice> {
  if (pending) {
    if (focus) document.querySelector<HTMLElement>('[data-consent-banner] button')?.focus();
    return pending;
  }
  pending = new Promise<Choice>((resolve) => {
    const box = document.createElement('div');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Privacy choices');
    box.setAttribute('data-consent-banner', '');
    box.style.cssText =
      'position:fixed;z-index:100;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));' +
      'margin:0 auto;max-width:28rem;padding:16px;border-radius:14px;border:1px solid var(--edge-strong);' +
      'background:var(--surface);color:var(--fg);box-shadow:0 8px 30px rgba(0,0,0,.18);font-size:14px;line-height:1.5';
    // Static markup only: no visitor data is ever placed in it.
    box.innerHTML =
      '<p style="margin:0;font-weight:600">Visit statistics</p>' +
      '<p style="margin:6px 0 0;color:var(--fg-muted)">May we record which pages you open, for how long and how far ' +
      'you scroll? It helps us keep SyncFlow secure and improve it. We never record what you type or your messages. ' +
      'You can change this any time from Privacy choices at the bottom of the page. ' +
      '<a href="/privacy#rights" style="color:var(--fg);text-decoration:underline">Privacy Policy</a></p>' +
      `<div style="display:flex;gap:8px;margin-top:12px"><button type="button" data-choice="n" style="${BUTTON}">Reject</button>` +
      `<button type="button" data-choice="y" style="${BUTTON}">Accept</button></div>`;
    box.addEventListener('click', (event) => {
      const choice = (event.target as Element).closest?.('[data-choice]')?.getAttribute('data-choice');
      if (choice !== 'y' && choice !== 'n') return;
      try {
        saveChoice(choice);
      } catch {
        // Cookies blocked: the choice still applies to this page.
      }
      box.remove();
      pending = null;
      resolve(choice);
    });
    document.body.append(box);
    if (focus) box.querySelector('button')?.focus();
  });
  return pending;
}
