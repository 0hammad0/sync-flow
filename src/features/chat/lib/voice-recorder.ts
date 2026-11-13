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

export type RecorderError = 'unsupported' | 'denied' | 'no_device' | 'busy' | 'failed';

/**
 * What start() rejects with. `detail` is the browser's own error name (for
 * example NotReadableError): several different causes all end up as
 * 'failed', and without the name a bug report can't tell them apart.
 */
export interface RecorderFailure {
  code: RecorderError;
  detail: string | null;
  /** The original error, for the console. */
  cause?: unknown;
}

const RECORDER_ERRORS: readonly RecorderError[] = ['unsupported', 'denied', 'no_device', 'busy', 'failed'];

/** The error's name, e.g. "NotReadableError". Old webviews reject with plain objects or strings. */
function errorName(err: unknown): string | null {
  if (typeof err === 'string') return err.slice(0, 40) || null;
  if (err && typeof err === 'object' && 'name' in err && typeof err.name === 'string') return err.name || null;
  return null;
}

function failure(code: RecorderError, cause?: unknown): RecorderFailure {
  return { code, detail: cause === undefined ? null : errorName(cause), cause };
}

/** Turns anything start() threw into a RecorderFailure; unknown errors count as 'failed'. */
export function toRecorderFailure(err: unknown): RecorderFailure {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (RECORDER_ERRORS as readonly unknown[]).includes(err.code)
  ) {
    return err as RecorderFailure;
  }
  return failure('failed', err);
}

/**
 * getUserMedia error → what to tell the person. The old Chrome names
 * (PermissionDeniedError, DevicesNotFoundError, TrackStartError) still turn
 * up in some Android webviews. OverconstrainedError only means our audio
 * settings were refused, not that there is no mic, so it stays 'failed'.
 */
function micErrorCode(err: unknown): RecorderError {
  switch (errorName(err)) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'no_device';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'failed';
  }
}

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

/**
 * The mic stream is kept open for a short while after a note, then closed.
 * iOS Safari is slow to open the mic, and opening it again can fail or mute
 * the previous stream, so back-to-back notes reuse one stream. It always
 * closes when the tab is hidden.
 */
const MIC_KEEP_MS = 20_000;
let micStream: MediaStream | null = null;
let micTimer: number | null = null;

function micLive(stream: MediaStream | null): boolean {
  // A muted track (audio session change, call) records silence: open a new one.
  return !!stream && stream.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted);
}

/** The getUserMedia call in progress, shared so two quick taps don't open the mic twice (on iOS the second capture can end the first). */
let micOpening: Promise<MediaStream> | null = null;

/**
 * Errors where asking again with plain `{ audio: true }` can work: our audio
 * settings were refused (OverconstrainedError, TypeError in some webviews),
 * or the mic was still being released by the last capture or another app
 * (NotReadableError, AbortError).
 */
const MIC_RETRY_ERRORS = new Set(['OverconstrainedError', 'TypeError', 'NotReadableError', 'TrackStartError', 'AbortError']);
/** Gives the OS a moment to free the mic before the one retry. */
const MIC_RETRY_MS = 300;

function stopMicTracks(): void {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}

function openMic(): Promise<MediaStream> {
  if (micTimer !== null) window.clearTimeout(micTimer);
  micTimer = null;
  // WebKit wants the session to allow recording before capture starts, not
  // after: release() leaves it on 'playback', and opening the mic from there
  // can fail. Set on reuse too, since the last note switched it back.
  setAudioSession('play-and-record');
  if (micStream && micLive(micStream)) return Promise.resolve(micStream);
  micOpening ??= requestMic().finally(() => {
    micOpening = null;
  });
  return micOpening;
}

async function requestMic(): Promise<MediaStream> {
  stopMicTracks();
  try {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      if (!MIC_RETRY_ERRORS.has(errorName(err) ?? '')) throw err;
      stopMicTracks();
      await new Promise((resolve) => window.setTimeout(resolve, MIC_RETRY_MS));
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    return micStream;
  } catch (err) {
    // Nothing is recording, and begin() paused the shared player before
    // asking, so hand the session back to the browser. The player sets
    // 'playback' itself each time it plays.
    setAudioSession('auto');
    throw err;
  }
}

/** Stop the mic now (the OS mic indicator goes off). */
export function closeMic(): void {
  if (micTimer !== null) window.clearTimeout(micTimer);
  micTimer = null;
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}

function closeMicSoon(): void {
  if (micTimer !== null) window.clearTimeout(micTimer);
  micTimer = window.setTimeout(closeMic, MIC_KEEP_MS);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') closeMic();
  });
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
   * (iOS only unlocks audio there). Rejects with a RecorderFailure.
   */
  async start(): Promise<void> {
    if (!canRecordVoice()) throw failure('unsupported');
    // A kept-open stream can look live and still refuse to record (iOS after
    // an audio session change). Only then is reopening worth a second try.
    const reused = micLive(micStream);
    try {
      this.stream = await openMic();
    } catch (err) {
      throw this.abandon(micErrorCode(err), err);
    }
    // The user may have cancelled while the permission prompt was open.
    if (this.finished) {
      this.release();
      return;
    }

    try {
      this.recorder = this.startRecorder(this.stream);
    } catch (err) {
      if (!reused) throw this.abandon('failed', err);
      this.stream = null;
      closeMic();
      try {
        this.stream = await openMic();
      } catch (err2) {
        throw this.abandon(micErrorCode(err2), err2);
      }
      if (this.finished) {
        this.release();
        return;
      }
      try {
        this.recorder = this.startRecorder(this.stream);
      } catch (err2) {
        throw this.abandon('failed', err2);
      }
    }

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

    this.state = 'recording';
    this.runStartedAt = performance.now();
    this.sampleTimer = window.setInterval(() => this.sample(), LEVEL_SAMPLE_MS);
  }

  /**
   * Create and start the MediaRecorder. Some browsers and webviews say a
   * type is supported and then refuse it (in the constructor or in start()),
   * or refuse the bitrate, so fall back to a recorder with no options and let
   * the browser pick. Throws when even that fails.
   */
  private startRecorder(stream: MediaStream): MediaRecorder {
    const mime = pickMime();
    const make = (options?: MediaRecorderOptions) => {
      const rec = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      rec.start();
      return rec;
    };
    try {
      return make({ ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
    } catch {
      return make();
    }
  }

  /**
   * start() failed: free this recording and close the mic now rather than in
   * MIC_KEEP_MS, so the next tap asks for a fresh stream instead of reusing
   * a broken one. Returns the error for start() to throw.
   */
  private abandon(code: RecorderError, cause: unknown): RecorderFailure {
    this.finished = true;
    this.state = 'stopped';
    this.release();
    closeMic();
    setAudioSession('auto');
    return failure(code, cause);
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

  /** Free this recording. The mic itself closes a few seconds later (see MIC_KEEP_MS). */
  private release(): void {
    if (this.sampleTimer !== null) window.clearInterval(this.sampleTimer);
    this.sampleTimer = null;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
    });
    if (this.stream) closeMicSoon();
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    setAudioSession('playback');
  }
}
