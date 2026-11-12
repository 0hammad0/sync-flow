'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Copy,
  Download,
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  Languages,
  Music,
  Plus,
  Reply,
  SmilePlus,
  Square,
} from 'lucide-react';
import { formatChatTime } from '@/shared/lib/time';
import { CHAT_REACTIONS, formatFileSize } from '@/shared/lib/utils';
import {
  CodeSnippet,
  detectCode,
  InlineCopyButton,
  LinkifiedText,
} from '@/features/chat/components/MessageContent';
import {
  ReactionDetails,
  ReactionEmojiGrid,
  ReactionPill,
  groupReactions,
} from '@/features/chat/components/MessageReactions';
import {
  AlbumDownloadAllButton,
  AttachmentDownloadButton,
  DownloadErrorText,
  MediaDownloadOverlay,
  SheetDownloadButton,
  useAlbumDownload,
  useAttachmentDownload,
} from '@/features/chat/components/AttachmentDownloadButton';
import {
  browserLanguageName,
  cleanAiOutput,
  getAiAvailability,
  isAbortError,
  streamAi,
} from '@/features/ai/lib/ai-client';
import {
  COPYABLE_TEXT_THRESHOLD,
  LARGE_MESSAGE_THRESHOLD,
  attachmentViewUrl,
  getAtts,
  isEmojiOnly,
  previewKind,
} from '@/features/chat/lib/chat-helpers';
import type { ChatAttachment, ChatMessage } from '@/types';

// Touch: hold this long on a bubble to open the action sheet.
const LONG_PRESS_MS = 450;
// Finger drift beyond this cancels the long-press (it's a scroll).
const LONG_PRESS_SLOP_PX = 10;

// Centered gray pill for join/leave announcements, WhatsApp-style.
export const SystemNotice = memo(function SystemNotice({ message }: { message: ChatMessage }) {
  const time = useMemo(() => formatChatTime(message.created_at), [message.created_at]);
  const verb = message.content === 'joined' ? 'joined' : 'left';
  return (
    <div className="flex justify-center">
      <span
        className="px-3 py-1 bg-surface-3/70 text-fg-muted text-[11px] rounded-full"
        title={time.tooltip}
      >
        <span className="font-medium">{message.sender_name}</span> {verb} · {time.display}
      </span>
    </div>
  );
});

interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  myDeviceHash: string; // reactor.id for this device — the only "is this me" test
  roomCode: string;
  highlighted: boolean;
  onReply: (m: ChatMessage) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onQuoteClick: (id: string) => void;
  onOpenViewer: (attachmentKey: string) => void;
}

// Small icon for the quoted attachment kind inside a reply block.
function QuoteKindIcon({ kind, className }: { kind: string | null | undefined; className: string }) {
  if (kind === 'image') return <ImageIcon className={className} />;
  if (kind === 'video') return <Film className={className} />;
  if (kind === 'audio') return <Music className={className} />;
  if (kind === 'file') return <FileIcon className={className} />;
  return null;
}

// memo: presence ticks every 2s in busy rooms — without this every tick
// would re-render every bubble. Props are referentially stable between
// message snapshots, so ticks skip the whole list.
export const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  myDeviceHash,
  roomCode,
  highlighted,
  onReply,
  onToggleReaction,
  onQuoteClick,
  onOpenViewer,
}: MessageBubbleProps) {
  const time = useMemo(() => formatChatTime(message.created_at), [message.created_at]);
  const [expanded, setExpanded] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  // Quick bar's "+" → full emoji grid (shared by the hover bar and the sheet).
  const [moreEmoji, setMoreEmoji] = useState(false);
  const reactionsRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Close the reaction popover on any click/touch outside the actions
  // cluster (capture phase so stopped propagation can't keep it open).
  useEffect(() => {
    if (!showReactions) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!actionsRef.current?.contains(e.target as Node)) {
        setShowReactions(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowReactions(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showReactions]);

  // Clamp the reaction popover inside the viewport — anchoring alone can
  // push it past either edge next to narrow bubbles on small screens.
  // Uses the standalone `translate` property so it composes with the
  // scale-in animation's `transform`.
  // Also flips it below the actions when the scroll area would clip its top
  // (the taller "+" grid on a message near the top of the list).
  useEffect(() => {
    if (!showReactions) return;
    const el = reactionsRef.current;
    if (!el) return;
    el.style.translate = '';
    el.style.top = '';
    el.style.bottom = '';
    let r = el.getBoundingClientRect();
    const scroller = el.closest<HTMLElement>('[data-chat-scroll]');
    const minTop = (scroller?.getBoundingClientRect().top ?? 0) + 4;
    if (r.top < minTop) {
      el.style.bottom = 'auto';
      el.style.top = 'calc(100% + 0.25rem)';
      r = el.getBoundingClientRect();
    }
    const vw = window.innerWidth;
    let dx = 0;
    if (r.left < 4) dx = 4 - r.left;
    else if (r.right > vw - 4) dx = vw - 4 - r.right;
    if (dx !== 0) el.style.translate = `${dx}px 0`;
  }, [showReactions, moreEmoji]);
  const atts = getAtts(message);
  const isLongText = atts.length === 1 && atts[0].is_long_text === true;
  const isLarge = message.content.length > LARGE_MESSAGE_THRESHOLD;
  const codeInfo = atts.length === 0 ? detectCode(message.content) : null;
  const bigEmoji = atts.length === 0 && isEmojiOnly(message.content);
  const allImages = atts.length > 1 && atts.every((a) => (a.mime_type || '').startsWith('image/'));

  // "Download all" — every attachment saved as one zip (see useAlbumDownload).
  const albumDownload = useAlbumDownload(roomCode, atts);
  // AI translation of this message, streamed in below the original text.
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [canTranslate, setCanTranslate] = useState(false);
  const translateAbort = useRef<AbortController | null>(null);
  useEffect(() => () => translateAbort.current?.abort(), []);
  useEffect(() => {
    let cancelled = false;
    getAiAvailability().then((a) => {
      if (!cancelled) setCanTranslate(a.tasks.includes('translate'));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const translateMessage = async () => {
    if (translating) {
      translateAbort.current?.abort(); // second tap = Stop
      return;
    }
    if (translation !== null) {
      setTranslation(null); // toggle off
      return;
    }
    setTranslating(true);
    setTranslation('');
    const ctrl = new AbortController();
    translateAbort.current = ctrl;
    try {
      const result = await streamAi(
        { task: 'translate', text: message.content, target: browserLanguageName() },
        (t) => setTranslation(t),
        ctrl.signal
      );
      setTranslation(cleanAiOutput(result) || null);
    } catch (err) {
      if (isAbortError(err)) {
        // Keep what streamed so far; nothing yet → close the panel.
        setTranslation((cur) => (cur ? cur : null));
      } else {
        setTranslation(`⚠ ${err instanceof Error ? err.message : 'Translation failed'}`);
      }
    }
    translateAbort.current = null;
    setTranslating(false);
  };
  const canTranslateThis = canTranslate && !!message.content && !bigEmoji && !codeInfo && !isLongText;

  // Touch long-press → action sheet (react / reply / copy / translate). The
  // click that follows the press is swallowed so it doesn't also open an
  // image or follow a link.
  const [sheetOpen, setSheetOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const pressFired = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressStart.current = null;
  };
  useEffect(() => cancelPress, []);
  // The sheet is portaled to <body>, but React still bubbles its events
  // through this component — only react to events from the bubble itself.
  const fromBubble = (e: React.SyntheticEvent) =>
    e.currentTarget.contains(e.target as Node);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || !fromBubble(e)) return;
    pressFired.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressFired.current = true;
      navigator.vibrate?.(10);
      setMoreEmoji(false);
      setSheetOpen(true);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const start = pressStart.current;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP_PX) cancelPress();
  };
  const [copied, setCopied] = useState(false);
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const reactionGroups = useMemo(() => groupReactions(message.reactions), [message.reactions]);

  // This device's current reaction (one per device) — highlighted in the
  // picker so you can see what you already reacted with. Device id only:
  // legacy name-keyed entries can't be toggled by this device anyway.
  const myReaction =
    reactionGroups.find((g) => g.reactors.some((r) => r.id === myDeviceHash))?.emoji ?? null;

  // "Who reacted" panel, opened from the pill. Closes itself if a live
  // update removes the last reaction (React's derive-during-render pattern).
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  if (detailsOpen && reactionGroups.length === 0) setDetailsOpen(false);

  // Hover/tap actions (react + reply) sit beside the bubble, WhatsApp-style.
  const actions = (
    <div
      ref={actionsRef}
      // Touch devices use long-press instead of these always-faint icons.
      className={`relative self-center shrink-0 flex items-center gap-0.5 pointer-coarse:hidden opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${
        mine ? 'order-first mr-0.5 sm:mr-1' : 'ml-0.5 sm:ml-1'
      }`}
    >
      <button
        type="button"
        onClick={() => {
          setMoreEmoji(false);
          setShowReactions((s) => !s);
        }}
        className="p-1.5 rounded-full text-fg-faint hover:text-fg hover:bg-surface-2 cursor-pointer"
        title="React"
        aria-label="React to message"
        aria-expanded={showReactions}
      >
        <SmilePlus className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onReply(message)}
        className="p-1.5 rounded-full text-fg-faint hover:text-fg hover:bg-surface-2 cursor-pointer"
        title="Reply"
        aria-label="Reply to message"
      >
        <Reply className="w-4 h-4" />
      </button>
      {canTranslateThis && (
        <button
          type="button"
          onClick={translateMessage}
          className={`p-1.5 rounded-full hover:bg-surface-2 cursor-pointer ${
            translating || translation !== null
              ? 'text-brand-text'
              : 'text-fg-faint hover:text-fg'
          }`}
          title={translating ? 'Stop translating' : translation !== null ? 'Hide translation' : 'Translate (AI)'}
          aria-label={
            translating
              ? 'Stop translating'
              : translation !== null
                ? 'Hide translation'
                : 'Translate message with AI'
          }
        >
          <Languages className={`w-4 h-4 ${translating ? 'animate-pulse' : ''}`} />
        </button>
      )}
      {showReactions && (
        <div
          ref={reactionsRef}
          // Grows toward the bubble (inward); the effect above then clamps
          // it to the viewport for narrow bubbles near either edge.
          className={`absolute bottom-full mb-1 z-10 bg-surface border border-edge shadow-lg animate-fade-in-scale ${
            moreEmoji ? 'rounded-2xl p-1.5' : 'flex items-center gap-0.5 rounded-full px-1.5 py-1'
          } ${mine ? 'left-0' : 'right-0'}`}
        >
          {moreEmoji ? (
            <ReactionEmojiGrid
              selected={myReaction}
              onPick={(emoji) => {
                onToggleReaction(message.id, emoji);
                setShowReactions(false);
              }}
            />
          ) : (
          <>
          {CHAT_REACTIONS.map((emoji) => {
            const active = emoji === myReaction;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onToggleReaction(message.id, emoji);
                  setShowReactions(false);
                }}
                className={`text-lg p-0.5 rounded-full transition-transform cursor-pointer hover:bg-surface-2 hover:scale-125 ${
                  active ? 'bg-brand/15 ring-1 ring-brand scale-110' : ''
                }`}
                aria-label={active ? `Remove ${emoji} reaction` : `React with ${emoji}`}
                aria-pressed={active}
              >
                {emoji}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreEmoji(true)}
            className="ml-0.5 p-1 rounded-full bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface-3 cursor-pointer"
            aria-label="More reactions"
            title="More reactions"
          >
            <Plus className="w-4 h-4" />
          </button>
          </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      id={`msg-${message.id}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
      onClickCapture={(e) => {
        if (pressFired.current && fromBubble(e)) {
          pressFired.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onContextMenu={(e) => {
        // Android fires contextmenu on long-press; our sheet replaces it.
        if (fromBubble(e) && (pressFired.current || pressTimer.current !== null)) e.preventDefault();
      }}
      className={`group flex ${mine ? 'justify-end' : 'justify-start'} rounded-xl transition-shadow duration-300 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none] ${
        highlighted ? 'ring-2 ring-brand ring-offset-2 ring-offset-canvas' : ''
      }`}
    >
      {/* Wrapper anchors the reaction pill on the bubble's bottom edge; its
          bottom margin keeps the overhanging pill clear of the next message. */}
      <div
        className={`relative min-w-0 max-w-[calc(100%-4.25rem)] sm:max-w-[75%] ${
          reactionGroups.length > 0 ? 'mb-4' : ''
        }`}
      >
      <div
        className={`rounded-2xl px-3 py-2 ${
          mine
            ? 'bg-brand text-white rounded-br-sm'
            : 'bg-surface-2 text-fg rounded-bl-sm'
        }`}
      >
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className={`text-xs font-medium ${mine ? 'text-white/85' : 'text-fg-muted'}`}>
            {message.sender_name}
          </span>
          <span
            className={`text-[10px] ${mine ? 'text-white/60' : 'text-fg-faint'}`}
            title={`${time.tooltip}${message.sender_tz ? ` (sent from ${message.sender_tz})` : ''}`}
          >
            {time.display}
          </span>
        </div>

        {/* Quoted message (tap to jump to the original) */}
        {message.reply_to && (
          <button
            type="button"
            onClick={() => onQuoteClick(message.reply_to!.id)}
            className={`block w-full text-left mb-1.5 px-2 py-1.5 rounded-lg border-l-4 cursor-pointer transition-colors ${
              mine
                ? 'bg-black/20 border-white/50 hover:bg-black/30'
                : 'bg-surface-3/70 border-brand hover:bg-surface-3'
            }`}
            title="Go to original message"
          >
            <span className={`block text-[11px] font-medium ${mine ? 'text-white/85' : 'text-brand-text'}`}>
              {message.reply_to.sender_name}
            </span>
            <span
              className={`flex items-center gap-1 text-xs truncate ${
                mine ? 'text-white/70' : 'text-fg-muted'
              }`}
            >
              <QuoteKindIcon
                kind={message.reply_to.attachment_kind}
                className="w-3 h-3 shrink-0"
              />
              <span className="truncate">{message.reply_to.snippet || 'Attachment'}</span>
            </span>
          </button>
        )}

        {isLongText ? (
          <LongTextView message={message} roomCode={roomCode} mine={mine} />
        ) : (
          atts.length > 0 && (
            <div>
              {/* Album header: count, total size, download-all */}
              {atts.length > 1 && (
                <div
                  className={`flex items-center justify-between gap-2 mb-1.5 text-[11px] ${
                    mine ? 'text-white/75' : 'text-fg-muted'
                  }`}
                >
                  <span>
                    {atts.length} files · {formatFileSize(atts.reduce((s, a) => s + a.size, 0))}
                  </span>
                  <AlbumDownloadAllButton controller={albumDownload} count={atts.length} mine={mine} />
                </div>
              )}
              {allImages ? (
                // Photo album: WhatsApp-style grid, each opens the viewer
                <div className="grid grid-cols-2 gap-1 mb-1">
                  {atts.map((a) => (
                    <div key={a.key} className="relative group/media">
                      <button
                        type="button"
                        onClick={() => onOpenViewer(a.key)}
                        className="block w-full cursor-zoom-in"
                        aria-label={`View image ${a.name}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- R2-redirect src */}
                        <img
                          src={attachmentViewUrl(roomCode, a.key)}
                          alt={a.name}
                          loading="lazy"
                          className="rounded-lg h-32 w-full object-cover"
                        />
                      </button>
                      <MediaDownloadOverlay roomCode={roomCode} attachment={a} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className={atts.length > 1 ? 'space-y-1' : ''}>
                  {atts.map((a) => (
                    <AttachmentView
                      key={a.key}
                      attachment={a}
                      roomCode={roomCode}
                      mine={mine}
                      onOpenViewer={onOpenViewer}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {message.content && !isLongText && (
          // Code snippets scroll internally (CodeSnippet caps its own height),
          // so only wrap NON-code large text in a scroll box — otherwise the
          // two nested max-heights produce a double scrollbar.
          <div
            className={
              isLarge && !expanded && !codeInfo
                ? 'max-h-[400px] overflow-auto rounded'
                : ''
            }
          >
            {bigEmoji ? (
              <div className="text-4xl sm:text-5xl leading-tight py-1 animate-emoji-pop">
                {message.content}
              </div>
            ) : codeInfo ? (
              <CodeSnippet code={codeInfo.code} lang={codeInfo.lang} />
            ) : (
              <LinkifiedText text={message.content} mine={mine} />
            )}
          </div>
        )}
        {/* AI translation, streamed under the original text */}
        {translation !== null && (
          <div
            className={`mt-1.5 pt-1.5 border-t text-sm whitespace-pre-wrap break-words ${
              mine ? 'border-white/20' : 'border-edge'
            }`}
            style={{ wordBreak: 'break-word' }}
          >
            <p
              className={`flex items-center gap-1 text-[10px] mb-0.5 ${
                mine ? 'text-white/70' : 'text-fg-faint'
              }`}
            >
              <Languages className="w-3 h-3" />
              {translating ? 'Translating…' : `Translated to ${browserLanguageName()}`}
              {translating && (
                <button
                  type="button"
                  onClick={() => translateAbort.current?.abort()}
                  className="ml-1 flex items-center gap-0.5 underline underline-offset-2 cursor-pointer"
                >
                  <Square className="w-2.5 h-2.5" />
                  Stop
                </button>
              )}
            </p>
            {translation || '…'}
          </div>
        )}
        {/* Expand/copy controls — code snippets manage their own scroll and
            copy, so these apply to plain text only. */}
        {!codeInfo && !isLongText && (isLarge || message.content.length >= COPYABLE_TEXT_THRESHOLD) && (
          <div className="flex items-center gap-3 mt-1">
            {isLarge && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className={`text-[10px] underline ${
                  mine ? 'text-white/80 hover:text-white' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {expanded ? 'Collapse' : `Show full (${message.content.length.toLocaleString()} chars)`}
              </button>
            )}
            {message.content.length >= COPYABLE_TEXT_THRESHOLD && (
              <InlineCopyButton text={message.content} title="Copy message" label="Copy" mine={mine} />
            )}
          </div>
        )}

      </div>
      {reactionGroups.length > 0 && (
        <ReactionPill
          groups={reactionGroups}
          myId={myDeviceHash}
          mine={mine}
          expanded={detailsOpen}
          onOpen={() => setDetailsOpen(true)}
          pillRef={pillRef}
        />
      )}
      </div>
      {actions}
      {sheetOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-label="Message actions">
            <div
              className="absolute inset-0 bg-black/40 animate-fade-in"
              onClick={() => setSheetOpen(false)}
              aria-hidden="true"
            />
            <div className="relative w-full max-w-md mx-2 mb-[max(0.5rem,env(safe-area-inset-bottom))] p-2 bg-surface border border-edge rounded-2xl shadow-lg animate-menu-up">
              {moreEmoji ? (
                <div className="px-1 pb-2 mb-1 border-b border-edge">
                  <ReactionEmojiGrid
                    large
                    selected={myReaction}
                    onPick={(emoji) => {
                      onToggleReaction(message.id, emoji);
                      setSheetOpen(false);
                    }}
                  />
                </div>
              ) : (
              <div className="flex items-center justify-between gap-0.5 px-1 pb-2 mb-1 border-b border-edge">
                {CHAT_REACTIONS.map((emoji) => {
                  const active = emoji === myReaction;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        onToggleReaction(message.id, emoji);
                        setSheetOpen(false);
                      }}
                      className={`text-2xl p-1.5 rounded-full cursor-pointer ${
                        active ? 'bg-brand/15 ring-1 ring-brand' : 'active:bg-surface-2'
                      }`}
                      aria-label={active ? `Remove ${emoji} reaction` : `React with ${emoji}`}
                      aria-pressed={active}
                    >
                      {emoji}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setMoreEmoji(true)}
                  className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-surface-2 text-fg-muted active:bg-surface-3 cursor-pointer"
                  aria-label="More reactions"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              )}
              <SheetButton
                icon={<Reply className="w-4 h-4" />}
                label="Reply"
                onClick={() => {
                  setSheetOpen(false);
                  onReply(message);
                }}
              />
              {message.content && !isLongText && (
                <SheetButton
                  icon={<Copy className="w-4 h-4" />}
                  label={copied ? 'Copied' : 'Copy text'}
                  onClick={() => {
                    void copyText();
                    window.setTimeout(() => setSheetOpen(false), 400);
                  }}
                />
              )}
              {canTranslateThis && (
                <SheetButton
                  icon={<Languages className="w-4 h-4" />}
                  label={translating ? 'Stop translating' : translation !== null ? 'Hide translation' : 'Translate'}
                  onClick={() => {
                    setSheetOpen(false);
                    void translateMessage();
                  }}
                />
              )}
              {/* Download (single file) / Download all (album) */}
              {atts.length === 1 && (
                <SheetDownloadButton
                  roomCode={roomCode}
                  attachment={atts[0]}
                  onDone={() => setSheetOpen(false)}
                />
              )}
              {atts.length > 1 && (
                <SheetButton
                  icon={<Download className="w-4 h-4" />}
                  label={`Download all (${atts.length})`}
                  onClick={() => {
                    setSheetOpen(false);
                    albumDownload.start();
                  }}
                />
              )}
            </div>
          </div>,
          document.body
        )}
      {detailsOpen && reactionGroups.length > 0 && (
        <ReactionDetails
          groups={reactionGroups}
          myId={myDeviceHash}
          returnFocusRef={pillRef}
          onClose={() => setDetailsOpen(false)}
          onRemove={(emoji) => {
            // Same emoji again = remove (server toggle), WhatsApp-style.
            onToggleReaction(message.id, emoji);
            setDetailsOpen(false);
          }}
        />
      )}
    </div>
  );
});

function SheetButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 text-sm text-fg rounded-xl active:bg-surface-2 hover:bg-surface-2 cursor-pointer text-left"
    >
      <span className="text-fg-muted">{icon}</span>
      {label}
    </button>
  );
}

// Body of an oversized text message (stored in R2). Shows the inline preview
// with formatting preserved; "Show full message" pulls the complete text on
// demand — readers who don't expand it never download the big body.
function LongTextView({
  message,
  roomCode,
  mine,
}: {
  message: ChatMessage;
  roomCode: string;
  mine: boolean;
}) {
  const att = message.attachment!;
  const [full, setFull] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const viewUrl = `/api/chat/${roomCode}/attachments?key=${encodeURIComponent(att.key)}`;
  const text = full ?? message.content;
  const codeInfo = detectCode(text);

  // Fetch the full R2-stored body once, caching it in state. Shared by the
  // "Show full message" button and Copy so both always get the complete text.
  const fetchFull = async (): Promise<string> => {
    if (full !== null) return full;
    const res = await fetch(viewUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    setFull(body);
    return body;
  };

  const loadFull = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await fetchFull();
    } catch {
      setLoadError('Failed to load the full message. Try again.');
    }
    setLoading(false);
  };

  return (
    <div>
      <div className={full ? 'max-h-[420px] overflow-auto rounded' : ''}>
        {codeInfo ? (
          <CodeSnippet code={codeInfo.code} lang={codeInfo.lang} />
        ) : (
          <LinkifiedText text={text} mine={mine} />
        )}
        {!full && <span className={mine ? 'text-white/60' : 'text-fg-faint'}>…</span>}
      </div>
      {loadError && <p className="mt-1 text-[11px] text-danger-text">{loadError}</p>}
      <div className="flex items-center gap-3 mt-1.5">
        <InlineCopyButton
          getText={fetchFull}
          title="Copy full message"
          label="Copy"
          mine={mine}
        />
        {!full && (
          <button
            type="button"
            onClick={loadFull}
            disabled={loading}
            className={`text-[11px] underline cursor-pointer ${
              mine ? 'text-white/80 hover:text-white' : 'text-brand-text hover:opacity-80'
            } ${loading ? 'opacity-60' : ''}`}
          >
            {loading ? 'Loading…' : `Show full message (${formatFileSize(att.size)})`}
          </button>
        )}
        <a
          href={`${viewUrl}&download=1`}
          className={`inline-flex items-center gap-1 text-[11px] underline ${
            mine ? 'text-white/80 hover:text-white' : 'text-fg-muted hover:text-fg'
          }`}
          title="Download as .txt"
        >
          <Download className="w-3 h-3" />
          .txt
        </a>
      </div>
    </div>
  );
}

// Inline media / file card for a shared attachment, WhatsApp-style.
// src points at our redirect endpoint, which always hands the browser a
// fresh signed URL — media keeps loading for the room's whole lifetime.
function AttachmentView({
  attachment,
  roomCode,
  mine,
  onOpenViewer,
}: {
  attachment: ChatAttachment;
  roomCode: string;
  mine: boolean;
  onOpenViewer: (attachmentKey: string) => void;
}) {
  const viewUrl = attachmentViewUrl(roomCode, attachment.key);
  const mime = attachment.mime_type || '';
  const kind = previewKind(attachment);
  // Shared by the card body and its download icon (audio row too).
  const download = useAttachmentDownload(roomCode, attachment);

  if (kind === 'image') {
    return (
      <div className="relative group/media mb-1 w-fit max-w-full">
        <button
          type="button"
          onClick={() => onOpenViewer(attachment.key)}
          className="block max-w-full cursor-zoom-in"
          title="View image"
          aria-label={`View image ${attachment.name}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- R2-redirect src, next/image can't optimize it */}
          <img
            src={viewUrl}
            alt={attachment.name}
            loading="lazy"
            className="rounded-lg max-h-72 w-auto max-w-full"
          />
        </button>
        <MediaDownloadOverlay roomCode={roomCode} attachment={attachment} />
      </div>
    );
  }
  if (mime.startsWith('video/')) {
    // Download sits top-right; the native play/seek controls are at the bottom.
    return (
      <div className="relative group/media mb-1 w-fit max-w-full">
        <video
          controls
          preload="metadata"
          src={viewUrl}
          className="block rounded-lg max-h-72 max-w-full"
        />
        <MediaDownloadOverlay roomCode={roomCode} attachment={attachment} />
      </div>
    );
  }
  if (mime.startsWith('audio/')) {
    return (
      <div className="mb-1">
        <div className="flex items-center gap-1.5">
          <audio controls preload="metadata" src={viewUrl} className="min-w-0 flex-1 max-w-full" />
          <AttachmentDownloadButton
            roomCode={roomCode}
            attachment={attachment}
            mine={mine}
            controller={download}
          />
        </div>
        <DownloadErrorText error={download.error} mine={mine} />
      </div>
    );
  }

  const previewable = kind === 'pdf' || kind === 'docx';
  const TypeIcon = previewable || mime.startsWith('text/') ? FileText : FileIcon;
  const cardClasses = `flex items-center gap-2.5 p-2.5 mb-1 w-full text-left rounded-xl border transition-colors cursor-pointer ${
    mine
      ? 'bg-black/20 border-white/25 hover:bg-black/30'
      : 'bg-surface border-edge hover:bg-surface-2'
  }`;
  // PDF / DOCX → card opens the in-chat viewer; everything else downloads.
  // Either way the icon on the card downloads in one tap. The card's main
  // button and the icon are siblings (no nested controls); the outer click
  // handler also catches taps on the card's padding.
  const cardAction = previewable ? () => onOpenViewer(attachment.key) : download.start;
  return (
    <div className={cardClasses} onClick={cardAction}>
      <button
        type="button"
        className={`flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 ${
          mine ? 'focus-visible:outline-white' : 'focus-visible:outline-brand'
        }`}
        title={previewable ? `Preview ${attachment.name}` : `Download ${attachment.name}`}
      >
        <TypeIcon className={`w-7 h-7 shrink-0 ${mine ? 'text-white/80' : 'text-fg-faint'}`} />
        <span className="min-w-0 flex-1">
          <span className={`block text-xs font-medium truncate ${mine ? 'text-white' : 'text-fg'}`}>
            {attachment.name}
          </span>
          <span className={`block text-[10px] ${mine ? 'text-white/60' : 'text-fg-muted'}`}>
            {formatFileSize(attachment.size)}
            {previewable && ' · tap to preview'}
          </span>
          <DownloadErrorText error={download.error} mine={mine} />
        </span>
      </button>
      <AttachmentDownloadButton
        roomCode={roomCode}
        attachment={attachment}
        mine={mine}
        controller={download}
      />
    </div>
  );
}
