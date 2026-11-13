import { describe, expect, it } from 'vitest';
import { formatVoiceTime, isVoiceMime, resamplePeaks } from '@/features/chat/lib/voice';

describe('formatVoiceTime', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [61_000, '1:01'],
    [-5, '0:00'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatVoiceTime(ms)).toBe(text);
  });
});

describe('isVoiceMime', () => {
  it('accepts what browsers record', () => {
    expect(isVoiceMime('audio/webm;codecs=opus')).toBe(true);
    expect(isVoiceMime('audio/mp4')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isVoiceMime('video/mp4')).toBe(false);
    expect(isVoiceMime('text/html')).toBe(false);
    expect(isVoiceMime(42)).toBe(false);
  });
});

describe('resamplePeaks', () => {
  it('returns the requested count, scaled so the loudest bar is 255', () => {
    const out = resamplePeaks([0, 10, 20, 40], 2);
    expect(out).toHaveLength(2);
    expect(Math.max(...out)).toBe(255);
  });

  it('returns zeros for silence and for no input', () => {
    expect(resamplePeaks([0, 0, 0], 3)).toEqual([0, 0, 0]);
    expect(resamplePeaks([], 4)).toEqual([0, 0, 0, 0]);
  });
});
