// Cookie names are written out (not imported from ../cookies) so the shared
// constants module stays out of the tracker chunk (2 KB budget).
// tests/unit/tracking/consent.test.ts checks they match REGION_COOKIE / CONSENT_COOKIE.

/**
 * Consent state, read in the browser (mode A, D-1 = yes). Used by the
 * tracker chunk (`loader.ts` keeps its own one-line copy of the stop rule).
 * Writing the choice lives in `banner.ts`, the only writer.
 *
 * Order of checks (`gate`):
 * 1. Global Privacy Control or Do Not Track → never run, never ask.
 * 2. Stored "Reject" or tracking switched off (`sf_cr=off`) → never run.
 * 3. Region not known yet (no or unknown `sf_cr`) → probe `GET /api/e` once.
 * 4. Stored "Accept" → run. EU/EEA/UK without a choice → ask. Elsewhere → run.
 *
 * Spec: docs/admin/01-architecture/08-privacy.md, 07-tracker.md.
 */

export type Gate = 'stop' | 'probe' | 'ask' | 'track';

export type ConsentState = {
  /** GPC or DNT is on. */
  signal: boolean;
  /** Raw `sf_consent` value: `y`, `n` or anything else (= no choice). */
  choice: string | null;
  /** Raw `sf_cr` value: `eu`, `ok`, `off` or anything else (= unknown). */
  region: string | null;
};

/** `name` is one of our fixed cookie names (letters and `_` only), so it is safe inside the pattern. */
export function readCookie(name: string, cookies: string = document.cookie): string | null {
  return new RegExp(`(?:^|;)\\s*${name}=([^;]*)`).exec(cookies)?.[1].trim() ?? null;
}

type PrivacyNavigator = { globalPrivacyControl?: boolean; doNotTrack?: string | null };

/** True when the browser sends Global Privacy Control or Do Not Track. */
export function privacySignal(nav: PrivacyNavigator = navigator as PrivacyNavigator): boolean {
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}

export function readState(cookies?: string): ConsentState {
  return {
    signal: privacySignal(),
    choice: readCookie('sf_consent', cookies),
    region: readCookie('sf_cr', cookies),
  };
}

export function gate({ signal, choice, region }: ConsentState): Gate {
  if (signal || choice === 'n' || region === 'off') return 'stop';
  if (region !== 'eu' && region !== 'ok') return 'probe';
  return choice === 'y' || region === 'ok' ? 'track' : 'ask';
}
