import { describe, expect, it } from 'vitest';

import { expiryTone, formatAgo, formatBytes, formatCountdown, formatNumber, formatTtl, formatUtc } from '@/features/admin/format';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

describe('admin format helpers', () => {
  it('bytes', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(12_700)).toBe('12.4 KB');
    expect(formatBytes(432_640_000)).toBe('412.6 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });

  it('countdown and tone', () => {
    expect(formatCountdown('2026-11-13T17:12:00.000Z', NOW)).toBe('in 5h 12m');
    expect(formatCountdown('2026-11-13T12:08:30.000Z', NOW)).toBe('in 0h 08m');
    expect(formatCountdown('2026-11-13T11:00:00.000Z', NOW)).toBe('Expired');
    expect(expiryTone('2026-11-13T12:30:00.000Z', NOW)).toBe('soon');
    expect(expiryTone('2026-11-13T15:00:00.000Z', NOW)).toBe('ok');
    expect(expiryTone('2026-11-13T11:59:00.000Z', NOW)).toBe('expired');
  });

  it('numbers, TTL, times', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(1204)).toBe('1,204');
    expect(formatTtl(1)).toBe('1 h');
    expect(formatTtl(24)).toBe('24 h');
    expect(formatTtl(168)).toBe('7 d');
    expect(formatUtc('2026-11-13T09:02:00.000Z')).toBe('13 Nov 2026, 09:02 UTC');
    expect(formatUtc(null)).toBe('—');
    expect(formatAgo('2026-11-13T10:00:00.000Z', NOW)).toBe('2 h ago');
    expect(formatAgo('2026-11-08T12:00:00.000Z', NOW)).toBe('5 d ago');
    expect(formatAgo(null, NOW)).toBe('—');
  });
});
