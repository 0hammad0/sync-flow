import { describe, expect, it } from 'vitest';
import type { TimelinePageDto } from '@/server/analytics/dto';
import {
  blockTargetFor,
  durationLabel,
  formatDuration,
  formatOffset,
  formatPaths,
  formatStarted,
  timelineItems,
} from '@/features/admin/sessions/format';

const page = (id: string, ts: string | null, path = `/${id}`): TimelinePageDto => ({
  id,
  ts,
  path,
  engagedMs: 1000,
  wallMs: 2000,
  scrollMax: 50,
});

describe('timelineItems', () => {
  const START = '2026-11-13T14:02:31.000Z';

  it('orders page views oldest first, whatever order they arrive in', () => {
    const items = timelineItems(
      [page('c', '2026-11-13T14:06:43.000Z'), page('a', START), page('b', '2026-11-13T14:03:18.000Z')],
      START,
    );
    expect(items.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(items.map((p) => formatOffset(p.offsetMs))).toEqual(['+0:00', '+0:47', '+4:12']);
  });

  it('breaks time ties by id and puts views without a time last', () => {
    const items = timelineItems([page('z', null), page('b', START), page('a', START), page('y', null)], START);
    expect(items.map((p) => p.id)).toEqual(['a', 'b', 'y', 'z']);
    expect(items[2].offsetMs).toBeNull();
  });

  it('does not change the input', () => {
    const input = [page('b', '2026-11-13T14:03:00.000Z'), page('a', START)];
    timelineItems(input, START);
    expect(input.map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('formatting', () => {
  it('durations to the second', () => {
    expect(formatDuration(252_000)).toBe('4m 12s');
    expect(formatDuration(4_000)).toBe('0m 04s');
    expect(formatDuration(3_780_000)).toBe('1h 03m');
    expect(formatDuration(0)).toBe('0m 00s');
    expect(durationLabel(252_000)).toBe('4 minutes 12 seconds');
    expect(durationLabel(61_000)).toBe('1 minute 1 second');
  });

  it('started: clock today, day + time before', () => {
    expect(formatStarted('2026-11-14T09:05:07.000Z', '2026-11-14')).toBe('09:05:07');
    expect(formatStarted('2026-11-13T14:02:31.000Z', '2026-11-14')).toBe('13 Nov 14:02');
    expect(formatStarted(null, '2026-11-14')).toBe('—');
  });

  it('entry → exit, one path when equal', () => {
    expect(formatPaths('/', '/chat/[code]')).toBe('/ → /chat/[code]');
    expect(formatPaths('/share/[token]', '/share/[token]')).toBe('/share/[token]');
    expect(formatPaths(null, '/x')).toBe('/x');
  });
});

describe('blockTargetFor', () => {
  it('full IP → ip block; truncated → its /24 or /48 range', () => {
    expect(blockTargetFor({ ip: '203.0.113.7', ipMasked: false, ipTruncated: false })).toEqual({ type: 'ip', value: '203.0.113.7' });
    expect(blockTargetFor({ ip: '203.0.113.0', ipMasked: false, ipTruncated: true })).toEqual({ type: 'cidr', value: '203.0.113.0/24' });
    expect(blockTargetFor({ ip: '2001:db8:85a3::', ipMasked: false, ipTruncated: true })).toEqual({ type: 'cidr', value: '2001:db8:85a3::/48' });
  });

  it('masked or missing IP → nothing to block', () => {
    expect(blockTargetFor({ ip: '203.0.113.•••', ipMasked: true, ipTruncated: false })).toBeNull();
    expect(blockTargetFor({ ip: null, ipMasked: false, ipTruncated: false })).toBeNull();
  });
});
