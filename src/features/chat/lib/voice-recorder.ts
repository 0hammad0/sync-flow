/**
 * Records one voice note in the browser: MediaRecorder for the audio, an
 * AnalyserNode for the live level meter and the stored waveform bars.
 *
 * Length is measured with our own clock, never read from the file: Chrome's
 * WebM recordings carry no duration ("Infinity" in <audio>).
 */

import { resamplePeaks, VOICE_MAX_MS, VOICE_PEAKS } from './voice';

export interface VoiceRecording {
  blob: Blob;
  mime: string;
  durationMs: number;
  peaks: number[];
}

export type RecorderError = 'unsupported' | 'denied' | 'no_device' | 'failed';

/**
 * Preferred containers, best first. Safari records MP4/AAC, which every
 * browser plays; Chrome and Firefox record WebM or Ogg with Opus. The real
 * type of the finished blob is what gets stored.
 */
const MIME_PREFERENCE = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
];

const LEVEL_SAMPLE_MS = 50;

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * Safari's audio session: 'play-and-record' while the mic is open, 'playback'
 * afterwards so notes still play with the ringer switch on silent. Other
 * browsers have no such API — this is a no-op there.
 */
export function setAudioSession(type: 'playback' | 'play-and-record' | 'auto'): void {
  try {
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) nav.audioSession.type = type;
  } catch {
    /* unsupported */
  }
}

export function canRecordVoice(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported(m));
}

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Uint8Array<ArrayBuffer> | null = null;
  private chunks: Blob[] = [];
  private sampleTimer: number | null = null;
  private runStartedAt = 0;
  private elapsedBefore = 0;
  private lastLevel = 0;
  private finished = false;
  /** One RMS level (0–1) per LEVEL_SAMPLE_MS of recorded audio. */
  readonly levels: number[] = [];
  state: 'idle' | 'recording' | 'paused' | 'stopped' = 'idle';

  /** Called when the mic stops on its own (phone locked, call, unplugged) or the max length is hit. */
  onAutoStop: (() => void) | null = null;

  /**
   * Ask for the mic and start recording. Must run inside the user's tap
   * (iOS only unlocks audio there). Rejects with a RecorderError.
   */
  async start(): Promise<void> {
    if (!canRecordVoice()) throw 'unsupported' satisfies RecorderError;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') throw 'denied' satisfies RecorderError;
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw 'no_device' satisfies RecorderError;
      }
      throw 'failed' satisfies RecorderError;
    }
    // The user may have cancelled while the permission prompt was open.
    if (this.finished) {
      this.release();
      return;
    }
    setAudioSession('play-and-record');

    const mime = pickMime();
    try {
      this.recorder = new MediaRecorder(this.stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 32_000,
      });
    } catch {
      this.release();
      throw 'failed' satisfies RecorderError;
    }
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    // Level meter. Not connected to the speakers, so there is no echo.
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      void this.ctx.resume();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.6;
      source.connect(this.analyser);
      this.buf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    } catch {
      this.analyser = null; // recording still works, just with a flat waveform
    }

    // Phone locked, incoming call, headset unplugged: the track ends. Keep
    // what was recorded and let the UI show it as a draft.
    for (const track of this.stream.getTracks()) {
      track.onended = () => this.autoStop();
    }

    this.recorder.start();
    this.state = 'recording';
    this.runStartedAt = performance.now();
    this.sampleTimer = window.setInterval(() => this.sample(), LEVEL_SAMPLE_MS);
  }

  private sample(): void {
    if (this.state !== 'recording') return;
    let level = 0;
    if (this.analyser && this.buf) {
      this.analyser.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) {
        const v = (this.buf[i] - 128) / 128;
        sum += v * v;
      }
      // RMS of speech sits around 0.02–0.3; lift it so quiet voices still
      // draw visible bars.
      level = Math.min(1, Math.sqrt(sum / this.buf.length) * 3.2);
    }
    this.lastLevel = level;
    this.levels.push(level);
    if (this.elapsedMs() >= VOICE_MAX_MS) this.autoStop();
  }

  private autoStop(): void {
    if (this.state === 'recording') this.pause();
    this.onAutoStop?.();
  }

  /** Latest level, 0–1, for the live meter. */
  level(): number {
    return this.state === 'recording' ? this.lastLevel : 0;
  }

  elapsedMs(): number {
    const running = this.state === 'recording' ? performance.now() - this.runStartedAt : 0;
    return Math.min(VOICE_MAX_MS, this.elapsedBefore + running);
  }

  canPause(): boolean {
    return typeof this.recorder?.pause === 'function';
  }

  pause(): void {
    if (this.state !== 'recording' || !this.recorder) return;
    this.elapsedBefore = this.elapsedMs();
    this.state = 'paused';
    try {
      if (this.recorder.state === 'recording') this.recorder.pause();
    } catch {
      /* already stopped by the browser */
    }
  }

  /** Returns true when recording really started again. */
  resume(): boolean {
    if (this.state !== 'paused' || !this.recorder || this.recorder.state !== 'paused') return false;
    if (this.elapsedBefore >= VOICE_MAX_MS) return false;
    this.recorder.resume();
    this.state = 'recording';
    this.runStartedAt = performance.now();
    return true;
  }

  /**
   * Audio recorded so far, for the preview while paused. Resolves to null
   * when the browser can't hand out data mid-recording.
   */
  async snapshot(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') {
      return this.chunks.length ? new Blob(this.chunks, { type: this.mimeType() }) : null;
    }
    return new Promise((resolve) => {
      const done = () => {
        rec.removeEventListener('dataavailable', done);
        resolve(this.chunks.length ? new Blob(this.chunks, { type: this.mimeType() }) : null);
      };
      rec.addEventListener('dataavailable', done);
      try {
        rec.requestData();
      } catch {
        rec.removeEventListener('dataavailable', done);
        resolve(null);
      }
    });
  }

  private mimeType(): string {
    return (this.recorder?.mimeType || this.chunks[0]?.type || 'audio/webm').replace(/\s+/g, '');
  }

  /** Finish and return the note (null when nothing was captured). */
  async stop(): Promise<VoiceRecording | null> {
    if (this.finished) return null;
    const durationMs = Math.round(this.elapsedMs());
    this.state = 'stopped';
    const rec = this.recorder;
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true });
        try {
          rec.stop();
        } catch {
          resolve();
        }
      });
    }
    this.finished = true;
    const mime = this.mimeType();
    const peaks = resamplePeaks(
      this.levels.map((l) => Math.round(l * 255)),
      VOICE_PEAKS
    );
    this.release();
    if (this.chunks.length === 0) return null;
    return { blob: new Blob(this.chunks, { type: mime }), mime, durationMs, peaks };
  }

  /** Throw the note away and free the mic. Safe to call at any time. */
  cancel(): void {
    this.finished = true;
    this.state = 'stopped';
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      /* ignore */
    }
    this.chunks = [];
    this.release();
  }

  /** Stop every track right away so the OS mic indicator goes off. */
  private release(): void {
    if (this.sampleTimer !== null) window.clearInterval(this.sampleTimer);
    this.sampleTimer = null;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    setAudioSession('playback');
  }
}
