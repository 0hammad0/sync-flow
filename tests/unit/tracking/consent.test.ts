// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { gate, privacySignal, readCookie, readState, type ConsentState } from '@/features/tracking/client/consent';
import { CONSENT_COOKIE, REGION_COOKIE } from '@/features/tracking/cookies';

function setNav(props: { globalPrivacyControl?: boolean; doNotTrack?: string | null }) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { configurable: true, get: () => value });
  }
}

afterEach(() => setNav({ globalPrivacyControl: undefined, doNotTrack: null }));

const state = (s: Partial<ConsentState>): ConsentState => ({ signal: false, choice: null, region: null, ...s });

describe('gate (consent rules, mode A)', () => {
  it('GPC / DNT stop everything, whatever the choice or region', () => {
    for (const choice of [null, 'y', 'n']) {
      for (const region of [null, 'eu', 'ok', 'off']) expect(gate(state({ signal: true, choice, region }))).toBe('stop');
    }
  });

  it('a stored Reject stops, in every region', () => {
    for (const region of [null, 'eu', 'ok']) expect(gate(state({ choice: 'n', region }))).toBe('stop');
  });

  it('tracking switched off (sf_cr=off) stops, even after Accept', () => {
    expect(gate(state({ choice: 'y', region: 'off' }))).toBe('stop');
  });

  it('unknown region → probe first (also after Accept: the probe carries the kill switch)', () => {
    expect(gate(state({}))).toBe('probe');
    expect(gate(state({ choice: 'y' }))).toBe('probe');
    expect(gate(state({ region: 'junk' }))).toBe('probe');
  });

  it('EU/EEA/UK without a choice → ask; after Accept → track', () => {
    expect(gate(state({ region: 'eu' }))).toBe('ask');
    expect(gate(state({ region: 'eu', choice: 'maybe' }))).toBe('ask');
    expect(gate(state({ region: 'eu', choice: 'y' }))).toBe('track');
  });

  it('outside consent regions → track without asking', () => {
    expect(gate(state({ region: 'ok' }))).toBe('track');
  });
});

describe('reading the browser state', () => {
  it('readCookie finds exact names only', () => {
    const jar = 'xsf_cr=no; sf_cr=eu;sf_consent=y ;  other=1';
    expect(readCookie('sf_cr', jar)).toBe('eu');
    expect(readCookie('sf_consent', jar)).toBe('y');
    expect(readCookie('missing', jar)).toBeNull();
    expect(readCookie('sf_cr', '')).toBeNull();
  });

  it('uses the shared cookie names (REGION_COOKIE / CONSENT_COOKIE)', () => {
    expect(readState(`${REGION_COOKIE}=ok; ${CONSENT_COOKIE}=n`)).toMatchObject({ region: 'ok', choice: 'n' });
  });

  it('reads document.cookie by default', () => {
    document.cookie = `${REGION_COOKIE}=eu`;
    expect(readState().region).toBe('eu');
    document.cookie = `${REGION_COOKIE}=; Max-Age=0`;
  });

  it('privacySignal: GPC true or DNT "1"; DNT "0" or unset is no signal', () => {
    expect(privacySignal({})).toBe(false);
    expect(privacySignal({ globalPrivacyControl: true })).toBe(true);
    expect(privacySignal({ globalPrivacyControl: false, doNotTrack: '0' })).toBe(false);
    expect(privacySignal({ doNotTrack: '1' })).toBe(true);
    setNav({ globalPrivacyControl: true });
    expect(readState().signal).toBe(true);
  });
});
