'use client';

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Mic, Pause, Play, AlertCircle } from 'lucide-react';
import type { ChatAttachment } from '@/types';
import { formatVoiceTime } from '../lib/voice';
import { useVoiceRate, useVoiceView, voicePlayer, type VoiceTrack } from '../lib/voice-player';
import { attachmentViewUrl } from '../lib/chat-helpers';
import { AttachmentDownloadButton, useAttachmentDownload } from './AttachmentDownloadButton';

/**
 * Waveform bars. Two stacked copies: the played part is the top copy,
 * clipped to the progress — so playback only changes one width, never the
 * bars themselves.
 */
function Bars({ peaks, className }: { peaks: number[]; className: string }) {
  return (
    <div className={`absolute inset-0 flex items-center gap-px min-[400px]:gap-[2px] ${className}`} aria-hidden="true">
      {peaks.map((p, i) => (
        <span
          key={i}
          className="flex-1 min-w-px max-w-[4px] rounded-full bg-current"
          style={{ height: `${Math.max(12, Math.round((p / 255) * 100))}%` }}
        />
      ))}
    </div>
  );
}

/**
 * A voice note inside a message bubble, WhatsApp-style:
 * play/pause · waveform you can drag to seek · length · speed chip.
 * The mic badge shows "played" state: on your own notes it lights up once
 * someone has listened; on others' notes it stays lit until you play it.
 */
export const VoiceNote = memo(function VoiceNote({
  messageId,
  attachment,
  roomCode,
  mine,
  senderName,
  playedByOthers,
  playedByMe,
}: {
  messageId: string;
  attachment: ChatAttachment;
  roomCode: string;
  mine: boolean;
  senderName: string;
  /** Own notes: someone else has played it. */
  playedByOthers: boolean;
  /** Others' notes: this device has played it (server state). */
  playedByMe: boolean;
}) {
  const voice = attachment.voice!;
  const track = useMemo<VoiceTrack>(
    () => ({
      id: messageId,
      url: attachmentViewUrl(roomCode, attachment.key),
      mime: attachment.mime_type,
      durationMs: voice.duration_ms,
      title: `Voice message from ${senderName}`,
    }),
    [messageId, roomCode, attachment.key, attachment.mime_type, voice.duration_ms, senderName]
  );
  const view = useVoiceView(messageId);
  const rate = useVoiceRate();
  const download = useAttachmentDownload(roomCode, attachment);
  const barsRef = useRef<HTMLDivElement>(null);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const dragging = useRef(false);

  const duration = voice.duration_ms;
  const shownMs = scrubMs ?? view.positionMs;
  const progress = duration > 0 ? Math.min(1, shownMs / duration) : 0;
  // Before playing: the full length. While playing/paused mid-way: time so far.
  const clock = view.active || shownMs > 0 ? formatVoiceTime(shownMs) : formatVoiceTime(duration);

  const msAt = useCallback(
    (clientX: number) => {
      const box = barsRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return 0;
      return Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * duration;
    },
    [duration]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubMs(msAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setScrubMs(msAt(e.clientX));
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (commit) voicePlayer().seek(track, msAt(e.clientX));
    setScrubMs(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1_000 : 5_000;
    let to: number | null = null;
    if (e.key === 'ArrowRight') to = view.positionMs + step;
    else if (e.key === 'ArrowLeft') to = view.positionMs - step;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = duration;
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      voicePlayer().toggle(track);
      return;
    }
    if (to !== null) {
      e.preventDefault();
      voicePlayer().seek(track, to);
    }
  };

  const unplayable = view.error === 'unsupported';
  const failed = view.error === 'failed';

  // Colours follow the bubble: own = brand background with white text.
  const base = mine ? 'text-white/45' : 'text-fg-faint/60';
  const played = mine ? 'text-white' : 'text-brand-text';
  const dot = mine ? 'bg-white' : 'bg-brand';
  // Mic badge: WhatsApp's blue "played" / green "new" states, in our palette.
  const micLit = mine ? playedByOthers : !playedByMe && !view.started;
  const micClass = mine
    ? playedByOthers
      ? 'text-sky-200'
      : 'text-white/60'
    : micLit
      ? 'text-brand-text'
      : 'text-fg-faint';

  return (
    <div className="voice-note flex items-center gap-2 w-[17.5rem] max-w-full min-w-0 py-0.5 select-none [-webkit-touch-callout:none]">
      <button
        type="button"
        onClick={() => voicePlayer().toggle(track)}
        disabled={unplayable}
        className={`relative shrink-0 h-11 w-11 -ml-1 flex items-center justify-center rounded-full transition-transform active:scale-90 touch-manipulation ${
          mine ? 'text-white hover:bg-white/10' : 'text-fg hover:bg-surface-3'
        } ${unplayable ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        aria-label={view.playing ? 'Pause voice message' : 'Play voice message'}
      >
        {view.loading && (
          <span
            className={`absolute inset-1.5 rounded-full border-2 border-transparent animate-spin ${
              mine ? 'border-t-white/80' : 'border-t-brand'
            }`}
            aria-hidden="true"
          />
        )}
        {view.playing ? (
          <Pause className="w-6 h-6 fill-current" />
        ) : (
          <Play className="w-6 h-6 fill-current translate-x-[1px]" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div
          ref={barsRef}
          role="slider"
          tabIndex={unplayable ? -1 : 0}
          aria-label="Voice message position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration / 1000)}
          aria-valuenow={Math.round(shownMs / 1000)}
          aria-valuetext={`${formatVoiceTime(shownMs)} of ${formatVoiceTime(duration)}`}
          onPointerDown={unplayable ? undefined : onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endDrag(e, true)}
          onPointerCancel={(e) => endDrag(e, false)}
          onKeyDown={onKeyDown}
          className="relative h-8 cursor-pointer touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded"
        >
          <Bars peaks={voice.peaks} className={base} />
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}
          >
            <Bars peaks={voice.peaks} className={played} />
          </div>
          {/* Seek dot */}
          <span
            className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full shadow-sm transition-transform ${dot} ${
              scrubMs !== null ? 'scale-125' : ''
            }`}
            style={{ left: `${progress * 100}%` }}
            aria-hidden="true"
          />
          {/* Time bubble while dragging */}
          {scrubMs !== null && (
            <span
              className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-fg text-canvas text-[11px] font-medium tabular-nums pointer-events-none animate-fade-in"
              style={{ left: `${progress * 100}%` }}
            >
              {formatVoiceTime(scrubMs)}
            </span>
          )}
        </div>
        <div
          className={`flex items-center gap-1.5 mt-0.5 text-[11px] tabular-nums ${
            mine ? 'text-white/75' : 'text-fg-muted'
          }`}
        >
          <span>{clock}</span>
          {unplayable && (
            <span className="flex items-center gap-1 min-w-0">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span className="truncate">Can&apos;t play here</span>
            </span>
          )}
          {failed && !unplayable && (
            <button
              type="button"
              onClick={() => voicePlayer().toggle(track)}
              className="underline cursor-pointer"
            >
              Retry
            </button>
          )}
        </div>
      </div>

      {/* Right slot: speed chip once the note is in use, mic badge otherwise.
          A download button replaces both when this browser can't play it. */}
      <div className="shrink-0 h-11 w-11 flex items-center justify-center">
        {unplayable ? (
          <AttachmentDownloadButton
            roomCode={roomCode}
            attachment={attachment}
            mine={mine}
            controller={download}
          />
        ) : view.active || view.started ? (
          <button
            type="button"
            onClick={() => voicePlayer().cycleRate()}
            className={`h-7 min-w-[2.75rem] px-2 rounded-full text-xs font-semibold tabular-nums cursor-pointer transition-colors animate-fade-in touch-manipulation ${
              mine ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-surface-3 text-fg hover:bg-edge'
            }`}
            aria-label={`Playback speed ${rate}x, tap to change`}
          >
            {rate}×
          </button>
        ) : (
          <span
            className={`relative h-10 w-10 rounded-full flex items-center justify-center ${
              mine ? 'bg-white/15' : 'bg-surface-3'
            }`}
            title={mine ? (playedByOthers ? 'Played' : 'Not played yet') : undefined}
          >
            <Mic className={`w-5 h-5 transition-colors ${micClass}`} />
            {mine && playedByOthers && <span className="sr-only">Played</span>}
          </span>
        )}
      </div>
    </div>
  );
});
