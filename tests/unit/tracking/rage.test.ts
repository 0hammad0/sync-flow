import { describe, expect, it } from 'vitest';

import { rageDetector, vwBucket } from '@/features/tracking/client/clicks';

/**
 * Rage rule (07-tracker.md, 03-data-model.md): ≥ 3 clicks within 600 ms
 * within 30 px → one `rage` event per burst.
 */
describe('rage detector', () => {
  const at = (t: number, x = 100, y = 100) => ({ t, x, y });

  it('2 clicks are not rage; the 3rd is', () => {
    const rage = rageDetector();
    expect(rage(at(0))).toBe(false);
    expect(rage(at(100))).toBe(false);
    expect(rage(at(200))).toBe(true);
  });

  it('time edge: 3 clicks spanning exactly 600 ms count, 601 ms do not', () => {
    const inside = rageDetector();
    inside(at(0));
    inside(at(300));
    expect(inside(at(600))).toBe(true);

    const outside = rageDetector();
    outside(at(0));
    outside(at(300));
    expect(outside(at(601))).toBe(false);
  });

  it('distance edge: within 30 px counts, 31 px does not', () => {
    const inside = rageDetector();
    inside(at(0, 100, 100));
    inside(at(50, 130, 100));
    expect(inside(at(100, 100, 130))).toBe(false); // 130,100 → 100,130 is 42 px: dropped from the window
    const near = rageDetector();
    near(at(0, 100, 100));
    near(at(50, 118, 100));
    expect(near(at(100, 100, 118))).toBe(true); // every earlier click ≤ 30 px from the last one

    const far = rageDetector();
    far(at(0, 100, 100));
    far(at(50, 100, 100));
    expect(far(at(100, 131, 100))).toBe(false);
  });

  it('one rage event per burst, a new burst after a calm click', () => {
    const rage = rageDetector();
    const fired = [0, 100, 200, 300, 400].map((t) => rage(at(t)));
    expect(fired).toEqual([false, false, true, false, false]);
    expect(rage(at(2_000))).toBe(false); // calm: ends the burst
    expect(rage(at(2_100))).toBe(false);
    expect(rage(at(2_200))).toBe(true);
  });

  it('clicks far apart in place never add up, however fast', () => {
    const rage = rageDetector();
    expect([0, 10, 20, 30].map((t, i) => rage(at(t, i * 200, 0)))).toEqual([false, false, false, false]);
  });
});

describe('viewport bucket', () => {
  it('sm < 640, md < 1024, lg ≥ 1024', () => {
    expect([0, 639, 640, 1023, 1024, 2560].map(vwBucket)).toEqual(['sm', 'sm', 'md', 'md', 'lg', 'lg']);
  });
});
