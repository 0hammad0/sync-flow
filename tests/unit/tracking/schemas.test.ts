import { describe, expect, it } from 'vitest';

import {
  MAX_EVENTS,
  engageEventSchema,
  pageviewEventSchema,
  parseBeacon,
  vitalsEventSchema,
} from '@/features/tracking/schemas';

const SID = '0123456789abcdef0123456789abcdef';
const pageview = { type: 'pageview', t: 1_763_000_000_000, pv: 'p1', path: '/chat/AB12CD', ref: 'https://news.example.com/x', vw: 390, vh: 844 };
const engage = { type: 'engage', t: 1_763_000_060_000, pv: 'p1', ms: 5_000, scroll: 50 };
const vitals = { type: 'vitals', t: 1_763_000_010_000, lcp: 1800, inp: 120, cls: 0.02 };

describe('event schemas', () => {
  it('accepts valid events and normalises the path', () => {
    expect(pageviewEventSchema.parse(pageview).path).toBe('/chat/[code]');
    expect(engageEventSchema.parse(engage)).toEqual(engage);
    expect(vitalsEventSchema.parse(vitals)).toEqual(vitals);
    expect(vitalsEventSchema.parse({ type: 'vitals', t: 1, inp: null })).toEqual({ type: 'vitals', t: 1, inp: null });
  });

  it('rejects unknown keys (nothing extra can ride along)', () => {
    expect(pageviewEventSchema.safeParse({ ...pageview, label: 'typed text' }).success).toBe(false);
    expect(engageEventSchema.safeParse({ ...engage, message: 'hi' }).success).toBe(false);
    expect(vitalsEventSchema.safeParse({ ...vitals, url: '/chat/AB12CD' }).success).toBe(false);
  });

  it('rejects oversize strings and out-of-range numbers', () => {
    expect(pageviewEventSchema.safeParse({ ...pageview, utm_source: 'x'.repeat(101) }).success).toBe(false);
    expect(pageviewEventSchema.safeParse({ ...pageview, ref: 'x'.repeat(2049) }).success).toBe(false);
    expect(pageviewEventSchema.safeParse({ ...pageview, path: `/${'a'.repeat(2048)}` }).success).toBe(false);
    expect(pageviewEventSchema.safeParse({ ...pageview, pv: 'x'.repeat(17) }).success).toBe(false);
    expect(pageviewEventSchema.safeParse({ ...pageview, vw: 20_001 }).success).toBe(false);
    expect(engageEventSchema.safeParse({ ...engage, ms: -1 }).success).toBe(false);
    expect(engageEventSchema.safeParse({ ...engage, ms: 3_600_001 }).success).toBe(false);
    expect(engageEventSchema.safeParse({ ...engage, scroll: 30 }).success).toBe(false);
    expect(vitalsEventSchema.safeParse({ ...vitals, cls: 101 }).success).toBe(false);
  });

  it('rejects a pageview of an unknown or private path', () => {
    for (const path of ['/admin', '/admin/files', '/api/e', '/chat/A/B', 'https://evil.example/x']) {
      expect(pageviewEventSchema.safeParse({ ...pageview, path }).success, path).toBe(false);
    }
  });
});

describe('parseBeacon', () => {
  it('keeps valid events and counts invalid ones', () => {
    const beacon = parseBeacon({ sid: SID, seq: 0, events: [pageview, { ...engage, extra: 1 }, vitals, 'junk'] });
    expect(beacon).toMatchObject({ sid: SID, seq: 0, final: false, did: null, invalid: 2 });
    expect(beacon?.events.map((e) => e.type)).toEqual(['pageview', 'vitals']);
  });

  it('reads final and the device id', () => {
    expect(parseBeacon({ sid: SID, seq: 3, final: true, did: 'device-1', events: [engage] })).toMatchObject({
      final: true,
      did: 'device-1',
      seq: 3,
    });
  });

  it.each([
    ['not an object', 'x'],
    ['bad sid', { sid: 'ABC', seq: 0, events: [engage] }],
    ['upper-case sid', { sid: SID.toUpperCase(), seq: 0, events: [engage] }],
    ['no events', { sid: SID, seq: 0, events: [] }],
    ['too many events', { sid: SID, seq: 0, events: Array(MAX_EVENTS + 1).fill(engage) }],
    ['negative seq', { sid: SID, seq: -1, events: [engage] }],
  ])('rejects the whole batch: %s', (_, json) => {
    expect(parseBeacon(json)).toBeNull();
  });

  it('accepts exactly MAX_EVENTS events', () => {
    expect(parseBeacon({ sid: SID, seq: 0, events: Array(MAX_EVENTS).fill(engage) })?.events).toHaveLength(MAX_EVENTS);
  });
});
