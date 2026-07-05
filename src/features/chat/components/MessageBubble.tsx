'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  Languages,
  Music,
  Reply,
  SmilePlus,
} from 'lucide-react';
import { formatChatTime } from '@/shared/lib/time';
import { downloadAllAsZip } from '@/shared/lib/zip';
import { CHAT_REACTIONS, formatFileSize, normalizeReactors } from '@/shared/lib/utils';
import {
  CodeSnippet,
  detectCode,
  InlineCopyButton,
  LinkifiedText,
} from '@/features/chat/components/MessageContent';
import {
  browserLanguageName,
  cleanAiOutput,
  getAiAvailability,
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
  myReactorIds: string[]; // this device's reactor id + legacy name-based id
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
  myReactorIds,
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
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [showReactions]);

  // Clamp the reaction popover inside the viewport — anchoring alone can
  // push it past either edge next to narrow bubbles on small screens.
  // Uses the standalone `translate` property so it composes with the
  // scale-in animation's `transform`.
  useEffect(() => {
    if (!showReactions) return;
    const el = reactionsRef.current;
    if (!el) return;
    el.style.translate = '';
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    let dx = 0;
    if (r.left < 4) dx = 4 - r.left;
    else if (r.right > vw - 4) dx = vw - 4 - r.right;
    if (dx !== 0) el.style.translate = `${dx}px 0`;
  }, [showReactions]);
  const atts = getAtts(message);
  const isLongText = atts.length === 1 && atts[0].is_long_text === true;
  const isLarge = message.content.length > LARGE_MESSAGE_THRESHOLD;
  const codeInfo = atts.length === 0 ? detectCode(message.content) : null;
  const bigEmoji = atts.length === 0 && isEmojiOnly(message.content);
  const allImages = atts.length > 1 && atts.every((a) => (a.mime_type || '').startsWith('image/'));

  // "Download all" — fetch every attachment and save one zip. Browsers
  // block programmatic downloads after the first click, so sequential
  // anchor clicks only ever land the first file.
  const [zipping, setZipping] = useState(false);
  // AI translation of this message, streamed in below the original text.
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [canTranslate, setCanTranslate] = useState(false);
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
    if (translating) return;
    if (translation !== null) {
      setTranslation(null); // toggle off
      return;
    }
    setTranslating(true);
    setTranslation('');
    try {
      const result = await streamAi(
        { task: 'translate', text: message.content, target: browserLanguageName() },
        (t) => setTranslation(t)
      );
      setTranslation(cleanAiOutput(result) || null);
    } catch (err) {
      setTranslation(`⚠ ${err instanceof Error ? err.message : 'Translation failed'}`);
    }
    setTranslating(false);
  };
  const downloadAll = async () => {
    if (zipping) return;
    setZipping(true);
    try {
      await downloadAllAsZip(
        atts.map((a) => ({ name: a.name, url: attachmentViewUrl(roomCode, a.key) })),
        `syncflow-${roomCode.toLowerCase()}-files.zip`
      );
    } finally {
      setZipping(false);
    }
  };
  const reactionEntries = Object.entries(message.reactions ?? {})
    .map(([emoji, list]) => [emoji, normalizeReactors(list)] as const)
    .filter(([, reactors]) => reactors.length > 0);

  // This device's current reaction (one per device) — highlighted in the
  // picker so you can see what you already reacted with.
  const myReaction =
    reactionEntries.find(([, reactors]) => reactors.some((r) => myReactorIds.includes(r.id)))?.[0] ??
    null;

  // Hover/tap actions (react + reply) sit beside the bubble, WhatsApp-style.
  const actions = (
    <div
      ref={actionsRef}
      className={`relative self-center shrink-0 flex items-center gap-0.5 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${
        mine ? 'order-first mr-0.5 sm:mr-1' : 'ml-0.5 sm:ml-1'
      }`}
    >
      <button
        type="button"
        onClick={() => setShowReactions((s) => !s)}
        className="p-1.5 rounded-full text-fg-faint hover:text-fg hover:bg-surface-2 cursor-pointer"
        title="React"
        aria-label="React to message"
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
      {canTranslate && message.content && !bigEmoji && !codeInfo && !isLongText && (
        <button
          type="button"
          onClick={translateMessage}
          className={`p-1.5 rounded-full hover:bg-surface-2 cursor-pointer ${
            translating || translation !== null
              ? 'text-brand-text'
              : 'text-fg-faint hover:text-fg'
          }`}
          title={translation !== null ? 'Hide translation' : 'Translate (AI)'}
          aria-label={translation !== null ? 'Hide translation' : 'Translate message with AI'}
        >
          <Languages className={`w-4 h-4 ${translating ? 'animate-pulse' : ''}`} />
        </button>
      )}
      {showReactions && (
        <div
          ref={reactionsRef}
          // Grows toward the bubble (inward); the effect above then clamps
          // it to the viewport for narrow bubbles near either edge.
          className={`absolute bottom-full mb-1 z-10 flex gap-0.5 bg-surface border border-edge rounded-full shadow-lg px-1.5 py-1 animate-fade-in-scale ${
            mine ? 'left-0' : 'right-0'
          }`}
        >
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
        </div>
      )}
    </div>
  );

  return (
    <div
      id={`msg-${message.id}`}
      className={`group flex ${mine ? 'justify-end' : 'justify-start'} rounded-xl transition-shadow duration-300 ${
        highlighted ? 'ring-2 ring-brand ring-offset-2 ring-offset-canvas' : ''
      }`}
    >
      <div
        className={`min-w-0 max-w-[calc(100%-4.25rem)] sm:max-w-[75%] rounded-2xl px-3 py-2 ${
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
                  <button
                    type="button"
                    onClick={downloadAll}
                    disabled={zipping}
                    className={`flex items-center gap-1 underline cursor-pointer disabled:opacity-60 disabled:cursor-wait ${
                      mine ? 'hover:text-white' : 'hover:text-fg'
                    }`}
                    title="Download all files as a zip"
                  >
                    <Download className="w-3 h-3" />
                    {zipping ? 'Preparing zip…' : 'Download all'}
                  </button>
                </div>
              )}
              {allImages ? (
                // Photo album: WhatsApp-style grid, each opens the viewer
                <div className="grid grid-cols-2 gap-1 mb-1">
                  {atts.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => onOpenViewer(a.key)}
                      className="cursor-zoom-in"
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

        {/* Reaction pills */}
        {reactionEntries.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {reactionEntries.map(([emoji, reactors]) => {
              const names = reactors.map((r) => r.name);
              const mineToo = reactors.some((r) => myReactorIds.includes(r.id));
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onToggleReaction(message.id, emoji)}
                  title={names.join(', ')}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors cursor-pointer ${
                    mine
                      ? mineToo
                        ? 'bg-white/25 border-white/60'
                        : 'bg-white/10 border-white/25 hover:bg-white/20'
                      : mineToo
                        ? 'bg-brand/10 border-brand/40'
                        : 'bg-surface border-edge hover:bg-surface-2'
                  }`}
                  aria-label={`${emoji} reaction from ${names.join(', ')}`}
                >
                  <span className="text-sm leading-none">{emoji}</span>
                  {reactors.length > 1 && (
                    <span className={mine ? 'text-white/80' : 'text-fg-muted'}>
                      {reactors.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {actions}
    </div>
  );
});

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
  const downloadUrl = `${viewUrl}&download=1`;
  const mime = attachment.mime_type || '';
  const kind = previewKind(attachment);

  if (kind === 'image') {
    return (
      <button
        type="button"
        onClick={() => onOpenViewer(attachment.key)}
        className="block mb-1 cursor-zoom-in"
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
    );
  }
  if (mime.startsWith('video/')) {
    return (
      <video
        controls
        preload="metadata"
        src={viewUrl}
        className="rounded-lg max-h-72 max-w-full mb-1"
      />
    );
  }
  if (mime.startsWith('audio/')) {
    return <audio controls preload="metadata" src={viewUrl} className="max-w-full mb-1" />;
  }

  const previewable = kind === 'pdf' || kind === 'docx';
  const TypeIcon = previewable || mime.startsWith('text/') ? FileText : FileIcon;
  const cardClasses = `flex items-center gap-2.5 p-2.5 mb-1 w-full text-left rounded-xl border transition-colors cursor-pointer ${
    mine
      ? 'bg-black/20 border-white/25 hover:bg-black/30'
      : 'bg-surface border-edge hover:bg-surface-2'
  }`;
  const inner = (
    <>
      <TypeIcon className={`w-7 h-7 shrink-0 ${mine ? 'text-white/80' : 'text-fg-faint'}`} />
      <span className="min-w-0 flex-1">
        <span className={`block text-xs font-medium truncate ${mine ? 'text-white' : 'text-fg'}`}>
          {attachment.name}
        </span>
        <span className={`block text-[10px] ${mine ? 'text-white/60' : 'text-fg-muted'}`}>
          {formatFileSize(attachment.size)}
          {previewable && ' · tap to preview'}
        </span>
      </span>
    </>
  );

  // PDF / DOCX → open the in-chat viewer; everything else downloads.
  if (previewable) {
    return (
      <div className={cardClasses} onClick={() => onOpenViewer(attachment.key)} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onOpenViewer(attachment.key)}
        title={`Preview ${attachment.name}`}
      >
        {inner}
        <a
          href={downloadUrl}
          onClick={(e) => e.stopPropagation()}
          className="p-1 -m-1"
          title={`Download ${attachment.name}`}
          aria-label={`Download ${attachment.name}`}
        >
          <Download className={`w-4 h-4 shrink-0 ${mine ? 'text-white/80' : 'text-fg-faint'}`} />
        </a>
      </div>
    );
  }
  return (
    <a href={downloadUrl} className={cardClasses} title={`Download ${attachment.name}`}>
      {inner}
      <Download className={`w-4 h-4 shrink-0 ${mine ? 'text-blue-100' : 'text-gray-400'}`} />
    </a>
  );
}
