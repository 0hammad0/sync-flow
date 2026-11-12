/**
 * One shared audio player for every voice note on the page, WhatsApp-style:
 * starting a note stops the other one, each note remembers where you
 * paused, the speed (1× / 1.5× / 2×) is remembered, and when a note ends
 * the next voice note in the chat starts by itself.
 *
 * One element is reused on purpose: iOS lets an element that was started
 * by a tap play again later from code, so auto-play of the next note works.
 */

'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { setAudioSession } from './voice-recorder';

export interface VoiceTrack {
  id: string;
  url: string;
  mime: string;
  durationMs: number;
  title: string;
}

export interface VoiceView {
  active: boolean;
  playing: boolean;
  loading: boolean;
  positionMs: number;
  /** True once this note has been started in this tab. */
  started: boolean;
  error: 'unsupported' | 'failed' | null;
}

export const VOICE_RATES = [1, 1.5, 2] as const;
export type VoiceRate = (typeof VOICE_RATES)[number];
const RATE_KEY = 'sf-voice-rate';

type Listener = () => void;

class VoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private track: VoiceTrack | null = null;
  private playing = false;
  private loading = false;
  private rate: VoiceRate = 1;
  private positions = new Map<string, number>();
  private started = new Set<string>();
  private errors = new Map<string, VoiceView['error']>();
  private listeners = new Set<Listener>();
  private views = new Map<string, VoiceView>();
  private frame: number | null = null;
  /** Given the note that just ended, returns the next one to auto-play. */
  nextResolver: ((id: string) => VoiceTrack | null) | null = null;
  /** Called the first time a note starts playing in this tab. */
  onFirstPlay: ((id: string) => void) | null = null;

  constructor() {
    try {
      const saved = Number(localStorage.getItem(RATE_KEY));
      if ((VOICE_RATES as readonly number[]).includes(saved)) this.rate = saved as VoiceRate;
    } catch {
      /* storage blocked */
    }
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private element(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = 'auto';
    // Faster speeds keep the normal voice pitch (default true; set anyway).
    a.preservesPitch = true;
    a.addEventListener('playing', () => {
      this.loading = false;
      this.playing = true;
      this.tick();
      this.emit();
    });
    a.addEventListener('waiting', () => {
      this.loading = true;
      this.emit();
    });
    a.addEventListener('pause', () => {
      this.playing = false;
      this.savePosition();
      this.stopTicking();
      this.emit();
    });
    a.addEventListener('ended', () => this.handleEnded());
    a.addEventListener('error', () => {
      if (!this.track || !a.src) return;
      this.errors.set(this.track.id, 'failed');
      this.playing = false;
      this.loading = false;
      this.stopTicking();
      this.emit();
    });
    this.audio = a;
    return a;
  }

  private savePosition() {
    if (!this.track || !this.audio) return;
    this.positions.set(this.track.id, this.audio.currentTime * 1000);
  }

  private tick = () => {
    this.savePosition();
    this.emit();
    this.frame = this.playing ? requestAnimationFrame(this.tick) : null;
  };

  private stopTicking() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private handleEnded() {
    const ended = this.track;
    this.playing = false;
    this.stopTicking();
    if (ended) this.positions.set(ended.id, 0);
    const next = ended && this.nextResolver ? this.nextResolver(ended.id) : null;
    if (next) {
      this.positions.set(next.id, 0);
      this.load(next);
    } else {
      this.emit();
    }
  }

  /** Can this browser play the note's format at all? */
  static canPlay(mime: string): boolean {
    if (typeof document === 'undefined') return true;
    const base = mime.split(';')[0].trim();
    const probe = document.createElement('audio');
    return probe.canPlayType(mime) !== '' || probe.canPlayType(base) !== '';
  }

  private load(track: VoiceTrack) {
    if (!VoicePlayer.canPlay(track.mime)) {
      this.errors.set(track.id, 'unsupported');
      this.emit();
      return;
    }
    const a = this.element();
    if (this.track?.id !== track.id) {
      if (this.track) this.savePosition();
      this.track = track;
      a.src = track.url;
    }
    this.errors.delete(track.id);
    a.playbackRate = this.rate;
    a.defaultPlaybackRate = this.rate;
    const resumeAt = (this.positions.get(track.id) ?? 0) / 1000;
    const startAt = resumeAt >= track.durationMs / 1000 - 0.15 ? 0 : resumeAt;
    if (Math.abs(a.currentTime - startAt) > 0.05) {
      try {
        a.currentTime = startAt;
      } catch {
        /* not seekable yet; the browser applies it once metadata loads */
      }
    }
    this.loading = true;
    setAudioSession('playback');
    this.updateMediaSession(track);
    if (!this.started.has(track.id)) {
      this.started.add(track.id);
      this.onFirstPlay?.(track.id);
    }
    this.emit();
    a.play().catch((err: unknown) => {
      this.loading = false;
      // NotAllowedError: auto-play blocked (no recent tap). Leave it ready to tap.
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          this.errors.set(track.id, 'failed');
        }
      }
      this.emit();
    });
  }

  toggle(track: VoiceTrack) {
    if (this.track?.id === track.id && (this.playing || this.loading)) {
      this.audio?.pause();
      this.loading = false;
      this.emit();
      return;
    }
    this.load(track);
  }

  /** Jump to a point. Works on notes that are not playing too. */
  seek(track: VoiceTrack, ms: number) {
    const clamped = Math.max(0, Math.min(track.durationMs, ms));
    this.positions.set(track.id, clamped);
    if (this.track?.id === track.id && this.audio) {
      try {
        this.audio.currentTime = clamped / 1000;
      } catch {
        /* applied on next play */
      }
    }
    this.emit();
  }

  pause() {
    this.audio?.pause();
  }

  getRate = (): VoiceRate => this.rate;

  cycleRate() {
    const i = VOICE_RATES.indexOf(this.rate);
    this.rate = VOICE_RATES[(i + 1) % VOICE_RATES.length];
    if (this.audio) {
      this.audio.playbackRate = this.rate;
      this.audio.defaultPlaybackRate = this.rate;
    }
    try {
      localStorage.setItem(RATE_KEY, String(this.rate));
    } catch {
      /* storage blocked */
    }
    this.emit();
  }

  /** Stable per-note snapshot: a bubble only re-renders when ITS state changes. */
  view(id: string): VoiceView {
    const active = this.track?.id === id;
    const next: VoiceView = {
      active,
      playing: active && this.playing,
      loading: active && this.loading,
      positionMs: this.positions.get(id) ?? 0,
      started: this.started.has(id),
      error: this.errors.get(id) ?? null,
    };
    const prev = this.views.get(id);
    if (
      prev &&
      prev.active === next.active &&
      prev.playing === next.playing &&
      prev.loading === next.loading &&
      prev.positionMs === next.positionMs &&
      prev.started === next.started &&
      prev.error === next.error
    ) {
      return prev;
    }
    this.views.set(id, next);
    return next;
  }

  private updateMediaSession(track: VoiceTrack) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: 'SyncFlow' });
      navigator.mediaSession.setActionHandler('play', () => this.load(track));
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if (d.seekTime !== undefined) this.seek(track, d.seekTime * 1000);
      });
    } catch {
      /* partial support */
    }
  }
}

let player: VoicePlayer | null = null;

/** The page's single player (created on first use, browser only). */
export function voicePlayer(): VoicePlayer {
  if (!player) player = new VoicePlayer();
  return player;
}

export function canPlayVoice(mime: string): boolean {
  return VoicePlayer.canPlay(mime);
}

const IDLE: VoiceView = {
  active: false,
  playing: false,
  loading: false,
  positionMs: 0,
  started: false,
  error: null,
};

/** Live state of one note. */
export function useVoiceView(id: string): VoiceView {
  const subscribe = useCallback((fn: Listener) => voicePlayer().subscribe(fn), []);
  return useSyncExternalStore(
    subscribe,
    () => voicePlayer().view(id),
    () => IDLE
  );
}

/** Current playback speed. */
export function useVoiceRate(): VoiceRate {
  const subscribe = useCallback((fn: Listener) => voicePlayer().subscribe(fn), []);
  return useSyncExternalStore(subscribe, () => voicePlayer().getRate(), () => 1 as VoiceRate);
}
