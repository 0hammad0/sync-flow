import { describe, expect, it } from 'vitest';

import { regionCookie, regionFor } from '@/features/tracking/server/region';

import { ingestHarness } from '../../support/tracking';

describe('regionFor (mode A consent regions)', () => {
  const EU27 = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ');

  it.each([...EU27, 'IS', 'LI', 'NO', 'GB'])('%s (EU/EEA/UK) → eu (ask)', (country) => {
    expect(regionFor(country, true)).toBe('eu');
  });

  it.each(['US', 'PK', 'IN', 'CH', 'CA', 'BR', 'AU', 'JP'])('%s → ok (no consent needed)', (country) => {
    expect(regionFor(country, true)).toBe('ok');
  });

  it('accepts lower case and spaces', () => {
    expect(regionFor(' de ', true)).toBe('eu');
  });

  it('missing or junk country: ask on Vercel, not off Vercel (local runs)', () => {
    for (const country of [null, '', 'XYZ', '1']) {
      expect(regionFor(country, true)).toBe('eu');
      expect(regionFor(country, false)).toBe('ok');
    }
  });
});

describe('regionCookie', () => {
  it('is a day for a region answer and an hour for "off"; Secure only over https', () => {
    expect(regionCookie('eu', false)).toBe('sf_cr=eu; Max-Age=86400; Path=/; SameSite=Lax');
    expect(regionCookie('ok', true)).toBe('sf_cr=ok; Max-Age=86400; Path=/; SameSite=Lax; Secure');
    expect(regionCookie('off', false)).toBe('sf_cr=off; Max-Age=3600; Path=/; SameSite=Lax');
  });

  it('is readable by the loader (not httpOnly) and holds no identifier', () => {
    expect(regionCookie('eu', true)).not.toMatch(/httponly/i);
  });
});

describe('IngestService kill-switch accessors (for GET /api/e)', () => {
  it('peek is null before the first read and never reads', async () => {
    const h = ingestHarness();
    expect(h.service.peekTrackingEnabled()).toBeNull();
    expect(h.repo.reads).toBe(0);
  });

  it('trackingEnabled reads through the same 60 s cache as ingest', async () => {
    const h = ingestHarness();
    h.repo.settings = { trackingEnabled: true };
    expect(await h.service.trackingEnabled()).toBe(true);
    expect(await h.service.trackingEnabled()).toBe(true);
    expect(h.repo.reads).toBe(1);
    expect(h.service.peekTrackingEnabled()).toBe(true);
  });

  it('a failed read means off (fail closed)', async () => {
    const h = ingestHarness();
    h.repo.readTrackingSettings = async () => {
      throw new Error('boom');
    };
    expect(await h.service.trackingEnabled()).toBe(false);
    expect(h.service.peekTrackingEnabled()).toBe(false);
  });
});
