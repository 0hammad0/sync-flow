/**
 * Voice notes: limits and helpers shared by the browser and the server.
 * No browser-only APIs here — the server imports this file to validate.
 */

import type { ChatVoice } from '@/types';

/** Shortest note we send. A quicker release is treated as a mis-tap. */
export const VOICE_MIN_MS = 1_000;
/** Longest note. Recording stops itself and keeps what it has. */
export const VOICE_MAX_MS = 5 * 60_000;
/** Number of waveform bars stored with each note (0–255 each). */
export const VOICE_PEAKS = 48;
/**
 * Byte cap for one note. 5 min of Opus at 32 kbps is ~1.2 MB; Safari's AAC
 * ignores the bitrate hint and can run several times higher.
 */
export const VOICE_MAX_BYTES = 15 * 1024 * 1024;

/** Containers we record into. Anything else is not a voice note. */
const VOICE_MIME_RE = /^audio\/(webm|ogg|mp4|aac|mpeg|x-m4a)(;[\w\s=.,"-]{0,80})?$/i;

export function isVoiceMime(mime: unknown): mime is string {
  return typeof mime === 'string' && mime.length <= 120 && VOICE_MIME_RE.test(mime);
}

/**
 * Validate client-sent voice metadata. Returns a clean copy, or null.
 * Duration is the client's own timer (Chrome's WebM files carry none), so
 * it is only range-checked; the bars are display data only.
 */
export function sanitizeVoice(raw: unknown): ChatVoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const { duration_ms, peaks } = raw as Record<string, unknown>;
  if (typeof duration_ms !== 'number' || !Number.isFinite(duration_ms)) return null;
  // Small slack under the minimum: the client timer and the release event
  // can disagree by a frame or two.
  if (duration_ms < VOICE_MIN_MS - 100 || duration_ms > VOICE_MAX_MS + 2_000) return null;
  if (!Array.isArray(peaks) || peaks.length === 0 || peaks.length > VOICE_PEAKS) return null;
  const clean: number[] = [];
  for (const p of peaks) {
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p > 255) return null;
    clean.push(p);
  }
  return { duration_ms: Math.round(duration_ms), peaks: clean };
}

/** 0:07, 1:23, 12:05 */
export function formatVoiceTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Shrink or stretch a level series to `count` bars (max of each bucket, so
 * short loud syllables survive), scaled so the loudest bar is 255.
 */
export function resamplePeaks(levels: ArrayLike<number>, count: number): number[] {
  const n = levels.length;
  if (n === 0) return new Array(count).fill(0);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * n) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * n) / count));
    let max = 0;
    for (let j = start; j < end && j < n; j++) max = Math.max(max, levels[j]);
    out.push(max);
  }
  const top = Math.max(...out);
  if (top <= 0) return out.map(() => 0);
  return out.map((v) => Math.round((v / top) * 255));
}

/** File extension for a recorded mime type (used in the stored filename). */
export function voiceExtension(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/mp4' || base === 'audio/x-m4a') return 'm4a';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/aac') return 'aac';
  if (base === 'audio/mpeg') return 'mp3';
  return 'webm';
}
