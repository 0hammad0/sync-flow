'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronUp, Lock, Mic, Pause, Play, Send, Trash2 } from 'lucide-react';
import { formatVoiceTime, VOICE_MIN_MS } from '../lib/voice';
import { canRecordVoice, VoiceRecorder, type RecorderError, type VoiceRecording } from '../lib/voice-recorder';
import { voicePlayer } from '../lib/voice-player';

/** Finger travel (px) that cancels / locks while holding. */
const CANCEL_DX = 110;
const LOCK_DY = 80;
/** How long the "Hold to record" tip stays up. */
const TIP_MS = 2_200;

type Phase = 'idle' | 'starting' | 'holding' | 'locked' | 'discarding';

const ERROR_TEXT: Record<RecorderError, string> = {
  unsupported: "This browser can't record audio.",
  denied: 'Microphone access is blocked. Allow it in your browser settings to send voice notes.',
  no_device: 'No microphone found.',
  failed: "Couldn't start the microphone. Please try again.",
};

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iOS: no vibration API */
  }
}

/**
 * Live level meter: newest bar on the right, older bars scroll left.
 * Drawn on a canvas each frame from the recorder's level history.
 */
function LiveWave({ recorder, className }: { recorder: VoiceRecorder | null; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !recorder) return;
    let frame = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = getComputedStyle(canvas).color;
        const bar = 2.5;
        const gap = 2;
        const count = Math.floor(w / (bar + gap));
        const levels = recorder.levels;
        const start = Math.max(0, levels.length - count);
        for (let i = start; i < levels.length; i++) {
          const x = w - (levels.length - i) * (bar + gap);
          const bh = Math.max(3, levels[i] * h);
          const y = (h - bh) / 2;
          ctx.beginPath();
          ctx.roundRect?.(x, y, bar, bh, bar / 2);
          if (!ctx.roundRect) ctx.rect(x, y, bar, bh);
          ctx.fill();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [recorder]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

/** Timer text written straight to the DOM each frame (no React re-render). */
function Clock({ recorder, className }: { recorder: VoiceRecorder | null; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (ref.current && recorder) ref.current.textContent = formatVoiceTime(recorder.elapsedMs());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recorder]);
  return (
    <span ref={ref} className={className}>
      0:00
    </span>
  );
}

/**
 * Draft preview while paused: plays what was recorded so far.
 * Uses its own <audio>, separate from the chat's shared player.
 */
function DraftPreview({ blob, durationMs }: { blob: Blob | null; durationMs: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  // The parent remounts this per snapshot (key), so state starts fresh.
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [broken, setBroken] = useState(false);

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url]
  );

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !playing) return;
    let frame = 0;
    const tick = () => {
      setPos(a.currentTime * 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else {
      voicePlayer().pause();
      a.play().catch(() => setBroken(true));
    }
  };

  const progress = durationMs > 0 ? Math.min(1, pos / durationMs) : 0;
  if (!blob || broken) {
    return <span className="flex-1 text-xs text-fg-muted truncate">Paused</span>;
  }
  return (
    <div className="flex-1 min-w-0 flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        className="shrink-0 h-9 w-9 flex items-center justify-center rounded-full text-fg hover:bg-surface-2 cursor-pointer touch-manipulation"
        aria-label={playing ? 'Pause preview' : 'Play preview'}
      >
        {playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
      </button>
      <div className="relative flex-1 h-1 rounded-full bg-surface-3 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 bg-brand rounded-full" style={{ width: `${progress * 100}%` }} />
      </div>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onError={() => setBroken(true)}
          className="hidden"
        />
      )}
    </div>
  );
}

/**
 * Voice recording for the chat composer, WhatsApp-style.
 *
 * Touch: hold the mic to record, release to send. Slide left to cancel,
 * slide up to lock (hands-free). Mouse/keyboard: click the mic to start
 * hands-free. Locked: pause/resume, preview the draft, delete, send.
 * Keys while recording: Esc = delete, Space = pause/resume, Enter = send.
 *
 * Renders the mic button plus an overlay that covers the composer row (the
 * row must be `relative`). The text box stays mounted underneath, so an
 * open phone keyboard does not jump.
 */
export function VoiceComposer({
  disabled,
  onSend,
  onError,
  onActiveChange,
}: {
  disabled: boolean;
  onSend: (rec: VoiceRecording) => void;
  onError: (message: string | null) => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [paused, setPaused] = useState(false);
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const [tip, setTip] = useState(false);
  const [preview, setPreview] = useState<{ blob: Blob | null; ms: number } | null>(null);
  const [recorder, setRecorder] = useState<VoiceRecorder | null>(null);
  const recRef = useRef<VoiceRecorder | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const pointerDown = useRef(false);
  const pointerId = useRef<number | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const tipTimer = useRef<number | null>(null);
  // Time of the last touch press. Safari's click after a touch carries no
  // pointerType, so without this a hold-to-send would start a new recording.
  const lastTouchAt = useRef(0);
  const supported = typeof window === 'undefined' ? true : canRecordVoice();

  const go = useCallback(
    (p: Phase) => {
      phaseRef.current = p;
      setPhase(p);
      onActiveChange?.(p !== 'idle');
    },
    [onActiveChange]
  );

  const showTip = useCallback(() => {
    setTip(true);
    if (tipTimer.current) window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTip(false), TIP_MS);
  }, []);

  const reset = useCallback(() => {
    recRef.current = null;
    setRecorder(null);
    setPaused(false);
    setPreview(null);
    setDrag({ dx: 0, dy: 0 });
    pointerDown.current = false;
    pointerId.current = null;
    go('idle');
  }, [go]);

  const discard = useCallback(() => {
    recRef.current?.cancel();
    vibrate(20);
    go('discarding');
    window.setTimeout(reset, 800);
  }, [go, reset]);

  const finish = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return reset();
    const tooShort = rec.elapsedMs() < VOICE_MIN_MS;
    if (tooShort) {
      rec.cancel();
      reset();
      showTip();
      return;
    }
    const result = await rec.stop();
    reset();
    if (result) onSend(result);
    else onError("Nothing was recorded. Please try again.");
  }, [onError, onSend, reset, showTip]);

  /** Mic stopped by itself, or the tab was hidden: keep the draft, paused. */
  const toPausedDraft = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return;
    rec.pause();
    setPaused(true);
    go('locked');
    setDrag({ dx: 0, dy: 0 });
    setPreview({ blob: await rec.snapshot(), ms: rec.elapsedMs() });
  }, [go]);

  const begin = useCallback(
    async (hold: boolean) => {
      onError(null);
      voicePlayer().pause();
      const rec = new VoiceRecorder();
      recRef.current = rec;
      rec.onAutoStop = () => void toPausedDraft();
      go('starting');
      try {
        await rec.start();
      } catch (err) {
        reset();
        onError(ERROR_TEXT[(err as RecorderError) in ERROR_TEXT ? (err as RecorderError) : 'failed']);
        return;
      }
      // Cancelled (or a different recording started) while the permission prompt was up.
      if (recRef.current !== rec || phaseRef.current !== 'starting') {
        rec.cancel();
        return;
      }
      // First-time permission prompt: the finger is usually gone by now.
      if (hold && !pointerDown.current) {
        rec.cancel();
        reset();
        showTip();
        return;
      }
      setRecorder(rec);
      vibrate(15);
      go(hold ? 'holding' : 'locked');
    },
    [go, onError, reset, showTip, toPausedDraft]
  );

  // ----- hold gesture (touch and pen) -----
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || phaseRef.current !== 'idle') return;
    if (e.pointerType === 'mouse') return; // mouse = click to start hands-free
    e.preventDefault(); // keep focus (and the phone keyboard) where it is
    lastTouchAt.current = Date.now();
    pointerDown.current = true;
    pointerId.current = e.pointerId;
    origin.current = { x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    void begin(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerDown.current || e.pointerId !== pointerId.current) return;
    if (phaseRef.current !== 'holding') return;
    const dx = Math.min(0, e.clientX - origin.current.x);
    const dy = Math.min(0, e.clientY - origin.current.y);
    if (-dx >= CANCEL_DX) {
      pointerDown.current = false;
      discard();
      return;
    }
    if (-dy >= LOCK_DY && -dx < CANCEL_DX / 2) {
      pointerDown.current = false;
      vibrate(10);
      setDrag({ dx: 0, dy: 0 });
      go('locked');
      return;
    }
    setDrag({ dx, dy });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== pointerId.current) return;
    const wasDown = pointerDown.current;
    pointerDown.current = false;
    if (!wasDown) return;
    if (phaseRef.current === 'holding') void finish();
    // 'starting': begin() sees pointerDown=false and shows the tip.
  };

  // The browser took the touch (scroll, system gesture, call): never send.
  const onPointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== pointerId.current || !pointerDown.current) return;
    pointerDown.current = false;
    if (phaseRef.current === 'holding') discard();
  };

  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Touch already handled by the hold gesture; this is mouse / keyboard.
    if (disabled || phaseRef.current !== 'idle') return;
    if (Date.now() - lastTouchAt.current < 1_000) return;
    const native = e.nativeEvent as PointerEvent;
    if (native.pointerType && native.pointerType !== 'mouse') return;
    void begin(false);
  };

  // ----- locked controls -----
  const togglePause = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      setPaused(true);
      setPreview({ blob: await rec.snapshot(), ms: rec.elapsedMs() });
    } else if (rec.state === 'paused') {
      if (rec.resume()) {
        setPaused(false);
        setPreview(null);
      }
    }
  }, []);

  // Keyboard while recording hands-free.
  useEffect(() => {
    if (phase !== 'locked') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        discard();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void finish();
      } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        void togglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, discard, finish, togglePause]);

  // App sent to the background mid-recording (iOS stops the mic there):
  // keep the draft instead of losing it.
  useEffect(() => {
    if (phase !== 'holding' && phase !== 'locked') return;
    const onHide = () => {
      if (document.visibilityState === 'hidden' && recRef.current?.state === 'recording') {
        pointerDown.current = false;
        void toPausedDraft();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [phase, toPausedDraft]);

  // Leaving the room mid-recording frees the mic.
  useEffect(
    () => () => {
      recRef.current?.cancel();
      if (tipTimer.current) window.clearTimeout(tipTimer.current);
    },
    []
  );

  if (!supported) return null;

  const holding = phase === 'holding';
  const locked = phase === 'locked';
  const cancelProgress = Math.min(1, -drag.dx / CANCEL_DX);
  const lockProgress = Math.min(1, -drag.dy / LOCK_DY);

  return (
    <>
      {/* Recording bar over the text box (holding) or the whole row (locked) */}
      {(holding || phase === 'starting' || phase === 'discarding') && (
        <div
          className="absolute inset-y-0 left-0 right-12 sm:right-14 z-10 flex items-center gap-3 pl-2 pr-1 bg-surface voice-bar-in"
          aria-live="polite"
        >
          {phase === 'discarding' ? (
            <span className="relative h-9 w-9 flex items-center justify-center" aria-label="Voice note deleted">
              <Mic className="absolute w-5 h-5 text-danger voice-mic-drop" />
              <span className="voice-bin-in flex flex-col items-center text-fg-muted">
                <Trash2 className="w-6 h-6" />
              </span>
            </span>
          ) : (
            <>
              <span className="flex items-center gap-2 shrink-0">
                <span className="h-2.5 w-2.5 rounded-full bg-danger voice-rec-dot" aria-hidden="true" />
                <Clock recorder={recorder} className="text-sm font-medium tabular-nums text-fg min-w-[2.6rem]" />
              </span>
              <span
                className="flex-1 min-w-0 flex items-center justify-center gap-1 text-sm text-fg-muted overflow-hidden"
                style={{ opacity: 1 - cancelProgress * 0.8, transform: `translateX(${drag.dx * 0.4}px)` }}
              >
                <ChevronLeft className={`w-4 h-4 shrink-0 ${drag.dx === 0 ? 'voice-nudge' : ''}`} />
                <span className="truncate">Slide to cancel</span>
              </span>
            </>
          )}
        </div>
      )}

      {locked && (
        <div className="absolute inset-0 z-20 flex items-center gap-1 sm:gap-2 bg-surface voice-bar-in" aria-live="polite">
          <button
            type="button"
            onClick={discard}
            className="shrink-0 h-11 w-11 flex items-center justify-center rounded-xl text-fg-muted hover:text-danger-text hover:bg-danger/10 cursor-pointer transition-colors touch-manipulation"
            aria-label="Delete voice note"
            title="Delete (Esc)"
          >
            <Trash2 className="w-5 h-5" />
          </button>
          <span className="flex items-center gap-2 shrink-0">
            <span
              className={`h-2.5 w-2.5 rounded-full ${paused ? 'bg-fg-faint' : 'bg-danger voice-rec-dot'}`}
              aria-hidden="true"
            />
            <Clock recorder={recorder} className="text-sm font-medium tabular-nums text-fg min-w-[2.6rem]" />
          </span>
          {paused ? (
            <DraftPreview
              key={preview?.ms ?? 0}
              blob={preview?.blob ?? null}
              durationMs={preview?.ms ?? 0}
            />
          ) : (
            <LiveWave recorder={recorder} className="flex-1 min-w-0 h-8 text-brand" />
          )}
          {recorder?.canPause() && (
            <button
              type="button"
              onClick={() => void togglePause()}
              className={`shrink-0 h-11 w-11 flex items-center justify-center rounded-xl cursor-pointer transition-colors touch-manipulation ${
                paused ? 'text-danger hover:bg-danger/10' : 'text-fg-muted hover:bg-surface-2'
              }`}
              aria-label={paused ? 'Resume recording' : 'Pause recording'}
              title={paused ? 'Resume (Space)' : 'Pause (Space)'}
            >
              {paused ? <Mic className="w-5 h-5" /> : <Pause className="w-5 h-5 fill-current" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => void finish()}
            className="shrink-0 h-11 w-11 flex items-center justify-center rounded-xl text-white bg-flow hover:brightness-110 hover:shadow-[var(--glow)] cursor-pointer transition-all active:scale-95 touch-manipulation"
            aria-label="Send voice note"
            title="Send (Enter)"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Mic button (+ lock pill above it while holding) */}
      <div className="relative shrink-0">
        {holding && (
          <div
            className="absolute bottom-full right-0 left-0 mb-3 flex justify-center pointer-events-none z-30"
            aria-hidden="true"
          >
            <div
              className="voice-pill-in flex flex-col items-center gap-1 w-11 py-2.5 rounded-full bg-surface border border-edge shadow-lg text-fg-muted"
              style={{ transform: `translateY(${drag.dy * 0.5}px)` }}
            >
              <Lock
                className="w-4 h-4 transition-colors"
                style={{ color: lockProgress > 0.6 ? 'var(--brand)' : undefined }}
              />
              <ChevronUp className="w-4 h-4 voice-lock-bob" />
            </div>
          </div>
        )}
        {tip && (
          <div
            role="status"
            className="absolute bottom-full right-0 mb-2 whitespace-nowrap px-3 py-1.5 rounded-lg bg-fg text-canvas text-xs font-medium shadow-lg animate-fade-in z-30"
          >
            Hold to record, release to send
          </div>
        )}
        {holding && (
          <span
            className="absolute inset-0 rounded-full bg-danger/40 voice-halo pointer-events-none"
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClick={onClick}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          disabled={disabled}
          className={`voice-hold relative z-30 h-11 w-11 flex items-center justify-center rounded-xl text-white transition-[transform,background-color] duration-150 ${
            disabled
              ? 'bg-surface-3 text-fg-faint cursor-not-allowed'
              : holding
                ? 'bg-danger rounded-full scale-[1.35] shadow-lg'
                : 'bg-flow hover:brightness-110 hover:shadow-[var(--glow)] cursor-pointer active:scale-95'
          }`}
          style={
            holding
              ? { transform: `translate(${Math.max(drag.dx, -CANCEL_DX) * 0.35}px, ${drag.dy * 0.35}px) scale(1.35)` }
              : undefined
          }
          aria-label="Record voice note"
          title="Record voice note (hold on phones, click on computers)"
        >
          <Mic className="w-5 h-5" />
        </button>
      </div>
    </>
  );
}
