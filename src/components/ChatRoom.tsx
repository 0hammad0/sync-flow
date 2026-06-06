'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import {
  collection,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import TextareaAutosize from 'react-textarea-autosize';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  MessageCircle,
  Music,
  Paperclip,
  QrCode,
  Reply,
  Send,
  Smile,
  SmilePlus,
  X,
} from 'lucide-react';
import { clientAuth, clientDb } from '@/lib/firebase/client';
import { clientTimezone, formatChatTime, formatTimeUntil } from '@/lib/time';
import {
  CHAT_REACTIONS,
  formatFileSize,
  INLINE_TEXT_BYTES,
  LONG_TEXT_PREVIEW_CHARS,
  MAX_LONG_TEXT_BYTES,
  normalizeReactors,
} from '@/lib/utils';
import LoadingSpinner from './LoadingSpinner';
import CopyButton from './CopyButton';
import QRModal from './QRModal';
import type {
  ChatAttachment,
  ChatMessage,
  ChatPresence,
  ChatRoom as ChatRoomType,
} from '@/types';

interface ChatRoomProps {
  room: ChatRoomType;
  joinUrl: string;
}

const STORED_NAME_KEY = 'syncflow.chatName';
const DEVICE_ID_KEY = 'syncflow.deviceId';

// Stable per-device id so "is this mine" doesn't depend on display names
// (two people can pick the same name). Survives reloads via localStorage;
// falls back to a per-tab id when storage is blocked.
let memoryDeviceId: string | null = null;
function getDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  const mint = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = mint();
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    memoryDeviceId = id;
  } catch {
    memoryDeviceId = mint();
  }
  return memoryDeviceId;
}
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const LARGE_MESSAGE_THRESHOLD = 4_000;
const MESSAGES_WINDOW = 500;
// Presence cadence — chosen so cost stays trivial: one tiny write per 25s
// per participant, plus at most one typing write per 2.5s WHILE typing.
const HEARTBEAT_MS = 25_000;
const TYPING_THROTTLE_MS = 2_500;
const ONLINE_WINDOW_MS = 60_000;

// Curated quick-picker set — the textarea also accepts any emoji from the
// OS keyboard (Win+. / Cmd+Ctrl+Space).
const EMOJI_SET = [
  '😀', '😂', '🤣', '😊', '😍', '😘', '😎', '🤩',
  '🥳', '😅', '😉', '🙃', '😢', '😭', '😡', '🤔',
  '🤗', '🤫', '😴', '🥺', '👍', '👎', '👏', '🙏',
  '🤝', '💪', '✌️', '🤞', '❤️', '🧡', '💛', '💚',
  '💙', '💜', '🖤', '💔', '🔥', '✨', '🎉', '🎂',
  '🌹', '☀️', '🌙', '⭐', '⚡', '💯', '✅', '❌',
];

// What the in-chat viewer can render. Anything else falls back to download.
function previewKind(att: ChatAttachment): 'image' | 'pdf' | 'docx' | null {
  const mime = att.mime_type || '';
  const name = (att.name || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) {
    return 'docx';
  }
  return null;
}

function attachmentViewUrl(roomCode: string, key: string): string {
  return `/api/chat/${roomCode}/attachments?key=${encodeURIComponent(key)}`;
}

// Emoji-only messages render extra large with a pop animation (WhatsApp-style).
function isEmojiOnly(content: string): boolean {
  const t = content.replace(/\s/g, '');
  if (!t || t.length > 16) return false;
  if (!/\p{Extended_Pictographic}/u.test(t)) return false;
  return /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️]+$/u.test(t);
}

function nameForUser(user: User | null): string {
  if (!user?.email) return '';
  return user.email.split('@')[0];
}

function byteLen(s: string): number {
  // TextEncoder is fast and accurate.
  return new TextEncoder().encode(s).length;
}

function looksLikeCode(content: string): boolean {
  // Very rough heuristic: fenced markdown, or many leading-tab/4-space lines.
  if (content.startsWith('```') || content.includes('\n```')) return true;
  const lines = content.split('\n');
  let indented = 0;
  for (const line of lines) {
    if (/^(\t| {2,})/.test(line)) indented++;
    if (indented >= 3) return true;
  }
  return false;
}

export default function ChatRoom({ room, joinUrl }: ChatRoomProps) {
  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [draftName, setDraftName] = useState('');
  const [askingName, setAskingName] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [deviceId] = useState(() => (typeof window === 'undefined' ? '' : getDeviceId()));
  const [now, setNow] = useState(() => Date.now());
  const [presence, setPresence] = useState<ChatPresence[]>([]);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingBeat = useRef(0);

  // Auth listener — set default name from email prefix when signed in.
  useEffect(() => {
    const unsub = onAuthStateChanged(clientAuth(), (u) => {
      setUser(u);
      // Only auto-fill if the user hasn't already picked / stored a name.
      const stored =
        typeof window !== 'undefined' ? window.localStorage.getItem(STORED_NAME_KEY) : '';
      if (stored) {
        setDisplayName(stored);
        setDraftName(stored);
        setAskingName(false);
      } else if (u?.email) {
        const auto = nameForUser(u);
        setDraftName(auto);
      }
    });
    return () => unsub();
  }, []);

  // Real-time message subscription.
  useEffect(() => {
    const q = query(
      collection(clientDb(), 'rooms', room.code, 'messages'),
      orderBy('created_at', 'asc'),
      limitToLast(MESSAGES_WINDOW)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: ChatMessage[] = snap.docs.map((d) => d.data() as ChatMessage);
        setMessages(next);
        setLoadingMessages(false);
      },
      (err) => {
        console.error('Chat snapshot error:', err);
        setLoadingMessages(false);
      }
    );
    return () => unsub();
  }, [room.code]);

  // Auto-scroll to bottom on new messages (only if user is already near bottom).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Periodic tick for "expires in" countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The chat fills the viewport below the site header. The header's height
  // varies (it wraps on small phones), so measure it instead of hard-coding —
  // otherwise the composer gets pushed off-screen on small mobiles.
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const setVar = () =>
      document.documentElement.style.setProperty('--site-header-h', `${header.offsetHeight}px`);
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(header);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--site-header-h');
    };
  }, []);

  // Real-time presence subscription (typing / online).
  useEffect(() => {
    const unsub = onSnapshot(
      collection(clientDb(), 'rooms', room.code, 'presence'),
      (snap) => setPresence(snap.docs.map((d) => d.data() as ChatPresence)),
      () => {} // presence is best-effort; chat works without it
    );
    return () => unsub();
  }, [room.code]);

  const sendHeartbeat = useCallback(
    (typing?: boolean) => {
      if (!displayName || !deviceId) return;
      void fetch(`/api/chat/${room.code}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, senderName: displayName, typing }),
      }).catch(() => {});
    },
    [room.code, displayName, deviceId]
  );

  // Keep-alive beats while in the room (one tiny write per 25s).
  useEffect(() => {
    if (askingName || !displayName) return;
    sendHeartbeat();
    const id = setInterval(() => sendHeartbeat(), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [askingName, displayName, sendHeartbeat]);

  // Others online/typing — derived locally from timestamps, zero extra I/O.
  const othersPresent = useMemo(
    () => presence.filter((p) => p.device_id !== deviceId),
    [presence, deviceId]
  );
  const onlineOthers = useMemo(
    () =>
      othersPresent.filter(
        (p) => new Date(p.last_seen).getTime() > presenceNow - ONLINE_WINDOW_MS
      ),
    [othersPresent, presenceNow]
  );
  const typingOthers = useMemo(
    () =>
      onlineOthers.filter(
        (p) => p.typing_until && new Date(p.typing_until).getTime() > presenceNow
      ),
    [onlineOthers, presenceNow]
  );

  // Tick the presence clock ONLY while someone else is around — an idle or
  // solo room re-renders nothing. MessageBubble is memoized, so these ticks
  // never re-render the message list either.
  useEffect(() => {
    if (othersPresent.length === 0) return;
    const id = setInterval(() => setPresenceNow(Date.now()), 2_000);
    return () => clearInterval(id);
  }, [othersPresent.length]);

  // Touch keyboards: Enter keeps inserting new lines (use the Send button),
  // matching WhatsApp mobile. Hardware keyboards: Enter sends.
  const isTouch = useMemo(
    () =>
      typeof window !== 'undefined' &&
      (navigator.maxTouchPoints > 0 || 'ontouchstart' in window),
    []
  );

  // Announce join once per room per tab (WhatsApp-style system message),
  // and announce leave via sendBeacon when the tab is closed/navigated away.
  useEffect(() => {
    if (askingName || !displayName) return;
    const joinedKey = `syncflow.joined.${room.code}`;
    let announced = false;
    try {
      announced = window.sessionStorage.getItem(joinedKey) === '1';
    } catch {
      /* sessionStorage blocked — announce every load, still correct */
    }
    if (!announced) {
      try {
        window.sessionStorage.setItem(joinedKey, '1');
      } catch {
        /* ok */
      }
      void fetch(`/api/chat/${room.code}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'join',
          senderName: displayName,
          tz: clientTimezone(),
          deviceId: getDeviceId(),
        }),
      }).catch(() => {});
    }
    const onPageHide = () => {
      try {
        window.sessionStorage.removeItem(joinedKey);
        navigator.sendBeacon(
          `/api/chat/${room.code}/presence`,
          new Blob(
            [
              JSON.stringify({
                event: 'leave',
                senderName: displayName,
                tz: clientTimezone(),
                deviceId: getDeviceId(),
              }),
            ],
            { type: 'application/json' }
          )
        );
      } catch {
        /* best effort */
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [askingName, displayName, room.code]);

  const timeRemaining = useMemo(() => {
    void now; // dep so it re-renders
    return formatTimeUntil(room.expires_at);
  }, [room.expires_at, now]);

  const handlePickName = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = draftName.trim().slice(0, 64);
    if (!cleaned) return;
    setDisplayName(cleaned);
    setAskingName(false);
    try {
      window.localStorage.setItem(STORED_NAME_KEY, cleaned);
    } catch {
      /* localStorage blocked — ok */
    }
  };

  // Share an image/video/file — XHR for real upload progress. With
  // opts.longText the "file" is the body of an oversized text message.
  const uploadAttachment = useCallback(
    (file: File, opts: { longText?: boolean } = {}) => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setSendError('File is larger than the 100MB limit.');
        return;
      }
      if (file.size === 0) {
        setSendError('That file is empty.');
        return;
      }
      setSendError(null);
      setUploadPercent(0);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('originalName', file.name);
      formData.append('senderName', displayName);
      formData.append(
        'caption',
        opts.longText ? draft.slice(0, LONG_TEXT_PREVIEW_CHARS) : draft.trim()
      );
      formData.append('tz', clientTimezone());
      formData.append('deviceId', deviceId);
      if (opts.longText) formData.append('longText', '1');
      if (replyTo) formData.append('replyToId', replyTo.id);

      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setUploadPercent(Math.round((e.loaded / e.total) * 100));
        }
      });
      xhr.addEventListener('load', () => {
        setUploadPercent(null);
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && res.success) {
            setDraft(''); // caption was sent along with the file
            setReplyTo(null);
          } else {
            setSendError(res.error || `Upload failed (HTTP ${xhr.status})`);
          }
        } catch {
          setSendError('Upload failed: invalid server response');
        }
      });
      xhr.addEventListener('error', () => {
        setUploadPercent(null);
        setSendError('Upload failed: network error');
      });
      xhr.addEventListener('abort', () => setUploadPercent(null));
      xhr.open('POST', `/api/chat/${room.code}/attachments`);
      xhr.send(formData);
    },
    [displayName, draft, room.code, replyTo, deviceId]
  );

  const handleSend = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      const content = draft;
      if (!content.trim() || sending) return;
      const bytes = byteLen(content);
      if (bytes > MAX_LONG_TEXT_BYTES) {
        setSendError('Message is too long (limit 15 MB).');
        return;
      }
      // Big text: Firestore docs cap at 1MB, so the body goes to R2 and the
      // bubble shows a preview with "Show full message". Same send button,
      // invisible to the user.
      if (bytes > INLINE_TEXT_BYTES) {
        uploadAttachment(
          new File([content], 'long-message.txt', { type: 'text/plain' }),
          { longText: true }
        );
        return;
      }
      setSending(true);
      setSendError(null);
      try {
        const res = await fetch(`/api/chat/${room.code}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderName: displayName,
            content,
            tz: clientTimezone(),
            deviceId,
            ...(replyTo ? { replyToId: replyTo.id } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setDraft('');
        setShowEmoji(false);
        setReplyTo(null);
        lastTypingBeat.current = 0;
        sendHeartbeat(false); // clear the typing flag immediately
        // The onSnapshot will deliver the new message; we don't optimistically
        // insert to avoid duplicate-render flicker.
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Failed to send');
      } finally {
        setSending(false);
      }
    },
    [draft, displayName, room.code, sending, replyTo, deviceId, sendHeartbeat, uploadAttachment]
  );

  // Throttled typing beat: at most one write per 2.5s while actually typing.
  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    if (value.trim() && Date.now() - lastTypingBeat.current > TYPING_THROTTLE_MS) {
      lastTypingBeat.current = Date.now();
      sendHeartbeat(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    // WhatsApp behavior: Enter sends, Shift+Enter inserts a new line.
    // Ctrl/Cmd+Enter still sends everywhere (including touch devices).
    if (e.metaKey || e.ctrlKey || (!e.shiftKey && !isTouch)) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Insert an emoji at the caret position and restore focus.
  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => d + emoji);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Toggle a reaction — the onSnapshot listener delivers the updated pills.
  const handleToggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      try {
        await fetch(`/api/chat/${room.code}/reactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, emoji, senderName: displayName, deviceId }),
        });
      } catch {
        /* transient network error — pills simply don't change */
      }
    },
    [room.code, displayName, deviceId]
  );

  const handleStartReply = useCallback((m: ChatMessage) => {
    setReplyTo(m);
    textareaRef.current?.focus();
  }, []);

  // Stable identity array so memoized bubbles don't re-render on parent ticks.
  const myReactorIds = useMemo(
    () => [deviceId, `legacy:${displayName}`],
    [deviceId, displayName]
  );

  // Attachments the in-chat viewer can show, in chat order — prev/next
  // navigates this list (WhatsApp media-viewer style).
  const viewableAttachments = useMemo(
    () =>
      messages.filter(
        (m): m is ChatMessage & { attachment: ChatAttachment } =>
          !!m.attachment && !m.attachment.is_long_text && previewKind(m.attachment) !== null
      ),
    [messages]
  );
  const handleOpenViewer = useCallback((key: string) => setLightboxKey(key), []);

  // Jump to the quoted message and flash it, WhatsApp-style.
  const jumpToMessage = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(id);
    window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1500);
  }, []);

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAttachment(file);
    e.target.value = ''; // allow re-picking the same file
  };

  if (askingName) {
    return (
      <div className="max-w-sm mx-auto px-4 py-12 animate-fade-in">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Pick a display name</h1>
        <p className="text-sm text-gray-600 mb-4">
          Others in the room will see this name on your messages.
        </p>
        <form onSubmit={handlePickName} className="space-y-3">
          <input
            autoFocus
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={64}
            placeholder="Your name"
            className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!draftName.trim()}
            className={`w-full py-2.5 rounded-lg text-white text-sm font-medium ${
              draftName.trim()
                ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                : 'bg-gray-400 cursor-not-allowed'
            }`}
          >
            Enter Room
          </button>
        </form>
        <p className="mt-3 text-xs text-gray-400">
          Saved locally so you don&apos;t have to enter it next time.
        </p>
      </div>
    );
  }

  return (
    <div className="-mx-4 -my-4 sm:-mx-6 sm:-my-6 lg:-mx-8 lg:-my-8 flex flex-col overflow-hidden h-[calc(100dvh-var(--site-header-h,3.75rem))] animate-fade-in">
      <div className="flex flex-col flex-1 min-h-0 w-full max-w-2xl mx-auto bg-white sm:my-4 sm:border sm:border-gray-200 sm:rounded-2xl sm:shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50/80">
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-gray-900 truncate leading-tight">
              {room.name || 'Chat Room'}
            </h1>
            <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <span className="font-mono tracking-wider sm:tracking-widest text-gray-600 whitespace-nowrap">
                {room.code}
              </span>
              <span className="text-gray-300 max-sm:hidden">|</span>
              {typingOthers.length > 0 ? (
                <span className="text-green-600 font-medium truncate min-w-0 max-w-full">
                  {typingOthers.length === 1
                    ? `${typingOthers[0].name} is typing…`
                    : typingOthers.length === 2
                      ? `${typingOthers[0].name} and ${typingOthers[1].name} are typing…`
                      : 'Several people are typing…'}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      onlineOthers.length > 0 ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  />
                  {onlineOthers.length + 1} online
                </span>
              )}
              <span className="text-gray-300 max-sm:hidden">|</span>
              <span
                className="whitespace-nowrap"
                title={`Expires ${new Date(room.expires_at).toLocaleString()}`}
              >
                {timeRemaining === 'expired' ? (
                  <span className="text-red-600 font-medium">expired</span>
                ) : (
                  <span className="text-gray-500">expires in {timeRemaining}</span>
                )}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <CopyButton text={joinUrl} />
            <button
              onClick={() => setShowQR(true)}
              className="p-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-100 cursor-pointer"
              title="Show QR code for joining"
              aria-label="Show QR code for joining"
            >
              <QrCode className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-2 sm:px-4 py-3 sm:py-4 space-y-3 bg-gray-50/40"
          aria-live="polite"
        >
          {loadingMessages ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner size="md" className="text-gray-400" />
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <MessageCircle className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm font-medium text-gray-600">No messages yet</p>
              <p className="text-xs text-gray-400 mt-1">
                Share the code or QR to invite others, then say hi
              </p>
            </div>
          ) : (
            messages.map((m) =>
              m.kind === 'system' ? (
                <SystemNotice key={m.id} message={m} />
              ) : (
                <MessageBubble
                  key={m.id}
                  message={m}
                  // Per-device id is the identity; name-match is only the
                  // fallback for messages sent before device ids existed.
                  mine={
                    m.sender_device_id
                      ? m.sender_device_id === deviceId
                      : m.sender_name === displayName
                  }
                  myReactorIds={myReactorIds}
                  roomCode={room.code}
                  highlighted={highlightId === m.id}
                  onReply={handleStartReply}
                  onToggleReaction={handleToggleReaction}
                  onQuoteClick={jumpToMessage}
                  onOpenViewer={handleOpenViewer}
                />
              )
            )
          )}

          {/* WhatsApp-style typing bubble with bouncing dots */}
          {typingOthers.length > 0 && (
            <div className="flex justify-start animate-fade-in">
              <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  {typingOthers.map((p) => p.name).join(', ')}
                </span>
                <span className="flex items-end gap-0.5" aria-label="typing">
                  <span className="typing-dot w-1.5 h-1.5 bg-gray-400 rounded-full" />
                  <span className="typing-dot w-1.5 h-1.5 bg-gray-400 rounded-full" />
                  <span className="typing-dot w-1.5 h-1.5 bg-gray-400 rounded-full" />
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSend}
          className="border-t border-gray-200 bg-white px-2 sm:px-4 pt-2.5 sm:pt-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:pb-3 space-y-2"
        >
          {sendError && (
            <p className="text-xs text-red-600 px-1">{sendError}</p>
          )}

          {/* Reply preview (WhatsApp-style bar above the input) */}
          {replyTo && (
            <div className="flex items-start gap-2 p-2 bg-gray-50 border-l-4 border-blue-500 rounded-lg animate-fade-in">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-blue-600">{replyTo.sender_name}</p>
                <p className="text-xs text-gray-500 truncate">
                  {replyTo.attachment ? replyTo.attachment.name : replyTo.content.slice(0, 120)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="p-1 text-gray-400 hover:text-gray-600 cursor-pointer"
                aria-label="Cancel reply"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Attachment upload progress */}
          {uploadPercent !== null && (
            <div className="flex items-center gap-2 px-1">
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-200"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-500 tabular-nums w-9 text-right">
                {uploadPercent}%
              </span>
            </div>
          )}

          {/* Emoji quick picker */}
          {showEmoji && (
            <div className="grid grid-cols-8 gap-0.5 p-2 border border-gray-200 rounded-xl bg-gray-50 animate-fade-in-scale max-h-40 overflow-y-auto">
              {EMOJI_SET.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => insertEmoji(emoji)}
                  className="text-xl p-1 rounded-lg hover:bg-gray-200 cursor-pointer transition-colors"
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-1 sm:gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setShowEmoji((s) => !s)}
              disabled={timeRemaining === 'expired'}
              className={`shrink-0 h-10 w-10 sm:h-11 sm:w-11 flex items-center justify-center rounded-xl transition-colors ${
                showEmoji ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'
              } ${timeRemaining === 'expired' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              title="Emoji"
              aria-label="Open emoji picker"
            >
              <Smile className="w-5 h-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFilePicked}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadPercent !== null || timeRemaining === 'expired'}
              className={`shrink-0 h-10 w-10 sm:h-11 sm:w-11 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 transition-colors ${
                uploadPercent !== null || timeRemaining === 'expired'
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer'
              }`}
              title="Attach photo, video, or file"
              aria-label="Attach photo, video, or file"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <TextareaAutosize
              ref={textareaRef}
              value={draft}
              onChange={handleDraftChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a message"
              title={
                isTouch ? undefined : 'Enter to send · Shift+Enter for a new line'
              }
              minRows={1}
              maxRows={6}
              className="flex-1 min-w-0 px-3 py-2 sm:py-2.5 text-base sm:text-sm leading-snug border border-gray-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={sending || timeRemaining === 'expired'}
            />
            <button
              type="submit"
              disabled={sending || !draft.trim() || timeRemaining === 'expired'}
              className={`shrink-0 h-10 w-10 sm:h-11 sm:w-11 flex items-center justify-center rounded-xl text-white transition-colors ${
                sending || !draft.trim() || timeRemaining === 'expired'
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
              }`}
              title="Send"
              aria-label="Send message"
            >
              {sending ? (
                <LoadingSpinner size="sm" className="text-white" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 px-1">
            Sending as <span className="font-medium text-gray-600">{displayName}</span>
            {!user && ' (guest)'}
            <span className="mx-1">&middot;</span>
            <button
              type="button"
              onClick={() => setAskingName(true)}
              className="underline hover:text-gray-600 cursor-pointer"
            >
              change name
            </button>
          </p>
        </form>
      </div>

      <QRModal
        isOpen={showQR}
        onClose={() => setShowQR(false)}
        url={joinUrl}
        fileName={room.name || `Room ${room.code}`}
      />

      {lightboxKey && (
        <MediaViewer
          items={viewableAttachments}
          activeKey={lightboxKey}
          roomCode={room.code}
          onClose={() => setLightboxKey(null)}
          onNavigate={setLightboxKey}
        />
      )}

      {timeRemaining === 'expired' && (
        <div className="fixed inset-x-0 bottom-0 bg-red-50 border-t border-red-200 px-4 py-2 text-center text-sm text-red-700">
          This room has expired. <Link href="/chat" className="underline">Create a new one</Link>
        </div>
      )}
    </div>
  );
}

// WhatsApp-style media viewer: images, PDFs and DOCX open in a modal with
// close / previous / next (buttons + arrow keys + Esc). Non-previewable
// files never get here — they download directly from the file card.
function MediaViewer({
  items,
  activeKey,
  roomCode,
  onClose,
  onNavigate,
}: {
  items: (ChatMessage & { attachment: ChatAttachment })[];
  activeKey: string;
  roomCode: string;
  onClose: () => void;
  onNavigate: (attachmentKey: string) => void;
}) {
  const index = items.findIndex((m) => m.attachment.key === activeKey);
  const current = index >= 0 ? items[index] : null;
  const prevKey = index > 0 ? items[index - 1].attachment.key : null;
  const nextKey = index >= 0 && index < items.length - 1 ? items[index + 1].attachment.key : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && prevKey) onNavigate(prevKey);
      else if (e.key === 'ArrowRight' && nextKey) onNavigate(nextKey);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = 'unset';
    };
  }, [onClose, onNavigate, prevKey, nextKey]);

  if (!current) return null;
  const att = current.attachment;
  const kind = previewKind(att);
  const viewUrl = attachmentViewUrl(roomCode, att.key);

  // Portal to <body>: the chat wrapper's fade-in animation retains a
  // transform, which would otherwise trap this "fixed" overlay inside it.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/90 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`Viewing ${att.name}`}
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{att.name}</p>
          <p className="text-xs text-gray-400 truncate">
            {current.sender_name} · {formatFileSize(att.size)}
            {items.length > 1 && ` · ${index + 1} / ${items.length}`}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={`${viewUrl}&download=1`}
            className="p-2 text-gray-300 hover:text-white rounded-lg hover:bg-white/10"
            title="Download"
            aria-label="Download"
          >
            <Download className="w-5 h-5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-300 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer"
            title="Close (Esc)"
            aria-label="Close viewer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-16 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {prevKey && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(prevKey);
            }}
            className="absolute left-1 sm:left-4 z-10 p-2 sm:p-2.5 text-white bg-black/40 sm:bg-white/10 hover:bg-white/25 rounded-full cursor-pointer"
            title="Previous (←)"
            aria-label="Previous attachment"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        <div
          className="w-full h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element -- R2-redirect src
            <img
              key={att.key}
              src={viewUrl}
              alt={att.name}
              className="max-h-full max-w-full object-contain rounded animate-fade-in-scale"
            />
          ) : kind === 'pdf' ? (
            <iframe
              key={att.key}
              src={viewUrl}
              title={att.name}
              className="w-full h-full max-w-4xl bg-white rounded-lg"
            />
          ) : (
            <DocxPreview key={att.key} url={viewUrl} downloadUrl={`${viewUrl}&download=1`} />
          )}
        </div>

        {nextKey && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(nextKey);
            }}
            className="absolute right-1 sm:right-4 z-10 p-2 sm:p-2.5 text-white bg-black/40 sm:bg-white/10 hover:bg-white/25 rounded-full cursor-pointer"
            title="Next (→)"
            aria-label="Next attachment"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

// Client-side DOCX preview via mammoth (dynamic import — only loaded when a
// .docx is actually opened; the document never leaves your storage).
function DocxPreview({ url, downloadUrl }: { url: string; downloadUrl: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ default: mammoth }, res] = await Promise.all([
          import('mammoth'),
          fetch(url),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        // Sanitize before dangerouslySetInnerHTML: a malicious docx could
        // smuggle scripts, on* handlers, or javascript: links into the HTML.
        const doc = new DOMParser().parseFromString(result.value, 'text/html');
        doc.querySelectorAll('script, iframe, object, embed, style, link').forEach((el) => el.remove());
        doc.querySelectorAll('*').forEach((el) => {
          for (const attr of Array.from(el.attributes)) {
            if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
          }
        });
        doc.querySelectorAll('a[href]').forEach((a) => {
          const href = (a.getAttribute('href') || '').trim();
          if (!/^(https?:|mailto:|#)/i.test(href)) {
            a.removeAttribute('href');
          } else {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
          }
        });
        doc.querySelectorAll('img').forEach((img) => {
          const src = img.getAttribute('src') || '';
          if (!/^data:image\//i.test(src)) img.remove();
        });
        if (!cancelled) setHtml(doc.body.innerHTML);
      } catch (err) {
        console.error('DOCX preview error:', err);
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <div className="text-center">
        <FileText className="w-10 h-10 mx-auto mb-3 text-gray-400" />
        <p className="text-sm text-gray-200 mb-3">Preview not available for this document.</p>
        <a
          href={downloadUrl}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-100"
        >
          <Download className="w-4 h-4" />
          Download instead
        </a>
      </div>
    );
  }
  if (html === null) {
    return (
      <div className="flex flex-col items-center gap-3 text-gray-300">
        <LoadingSpinner size="lg" className="text-white" />
        <span className="text-xs">Preparing preview…</span>
      </div>
    );
  }
  return (
    <div className="w-full h-full max-w-3xl overflow-y-auto bg-white rounded-lg">
      <div
        className="docx-preview px-6 sm:px-10 py-8 text-sm text-gray-900 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mb-2 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:border-collapse [&_td]:border [&_td]:border-gray-300 [&_td]:px-2 [&_td]:py-1 [&_img]:max-w-full"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// Centered gray pill for join/leave announcements, WhatsApp-style.
const SystemNotice = memo(function SystemNotice({ message }: { message: ChatMessage }) {
  const time = useMemo(() => formatChatTime(message.created_at), [message.created_at]);
  const verb = message.content === 'joined' ? 'joined' : 'left';
  return (
    <div className="flex justify-center">
      <span
        className="px-3 py-1 bg-gray-200/70 text-gray-600 text-[11px] rounded-full"
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
const MessageBubble = memo(function MessageBubble({
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
  const isLongText = message.attachment?.is_long_text === true;
  const isLarge = message.content.length > LARGE_MESSAGE_THRESHOLD;
  const isCode = !message.attachment && looksLikeCode(message.content);
  const bigEmoji = !message.attachment && isEmojiOnly(message.content);
  const reactionEntries = Object.entries(message.reactions ?? {})
    .map(([emoji, list]) => [emoji, normalizeReactors(list)] as const)
    .filter(([, reactors]) => reactors.length > 0);

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
        className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer"
        title="React"
        aria-label="React to message"
      >
        <SmilePlus className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onReply(message)}
        className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer"
        title="Reply"
        aria-label="Reply to message"
      >
        <Reply className="w-4 h-4" />
      </button>
      {showReactions && (
        <div
          ref={reactionsRef}
          // Grows toward the bubble (inward); the effect above then clamps
          // it to the viewport for narrow bubbles near either edge.
          className={`absolute bottom-full mb-1 z-10 flex gap-0.5 bg-white border border-gray-200 rounded-full shadow-lg px-1.5 py-1 animate-fade-in-scale ${
            mine ? 'left-0' : 'right-0'
          }`}
        >
          {CHAT_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onToggleReaction(message.id, emoji);
                setShowReactions(false);
              }}
              className="text-lg p-0.5 rounded-full hover:bg-gray-100 hover:scale-125 transition-transform cursor-pointer"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      id={`msg-${message.id}`}
      className={`group flex ${mine ? 'justify-end' : 'justify-start'} rounded-xl transition-shadow duration-300 ${
        highlighted ? 'ring-2 ring-blue-400 ring-offset-2' : ''
      }`}
    >
      <div
        className={`min-w-0 max-w-[calc(100%-4.25rem)] sm:max-w-[75%] rounded-2xl px-3 py-2 ${
          mine
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-gray-100 text-gray-900 rounded-bl-sm'
        }`}
      >
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className={`text-xs font-medium ${mine ? 'text-blue-100' : 'text-gray-700'}`}>
            {message.sender_name}
          </span>
          <span
            className={`text-[10px] ${mine ? 'text-blue-200' : 'text-gray-400'}`}
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
                ? 'bg-blue-700/50 border-blue-300 hover:bg-blue-700/70'
                : 'bg-gray-200/70 border-blue-500 hover:bg-gray-200'
            }`}
            title="Go to original message"
          >
            <span className={`block text-[11px] font-medium ${mine ? 'text-blue-100' : 'text-blue-600'}`}>
              {message.reply_to.sender_name}
            </span>
            <span
              className={`flex items-center gap-1 text-xs truncate ${
                mine ? 'text-blue-100/80' : 'text-gray-600'
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
          message.attachment && (
            <AttachmentView
              attachment={message.attachment}
              roomCode={roomCode}
              mine={mine}
              onOpenViewer={onOpenViewer}
            />
          )
        )}

        {message.content && !isLongText && (
          <div
            className={
              isLarge && !expanded
                ? 'max-h-[400px] overflow-auto rounded'
                : ''
            }
          >
            {bigEmoji ? (
              <div className="text-4xl sm:text-5xl leading-tight py-1 animate-emoji-pop">
                {message.content}
              </div>
            ) : isCode ? (
              <pre
                className={`text-xs sm:text-sm font-mono whitespace-pre overflow-x-auto ${
                  mine ? '' : 'text-gray-900'
                }`}
              >
                {message.content}
              </pre>
            ) : (
              <div
                className="text-sm whitespace-pre-wrap break-words"
                style={{ wordBreak: 'break-word' }}
              >
                {message.content}
              </div>
            )}
          </div>
        )}
        {isLarge && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className={`mt-1 text-[10px] underline ${
              mine ? 'text-blue-100 hover:text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {expanded ? 'Collapse' : `Show full (${message.content.length.toLocaleString()} chars)`}
          </button>
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
                        ? 'bg-blue-50 border-blue-300'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                  aria-label={`${emoji} reaction from ${names.join(', ')}`}
                >
                  <span className="text-sm leading-none">{emoji}</span>
                  {reactors.length > 1 && (
                    <span className={mine ? 'text-blue-100' : 'text-gray-600'}>
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
  const asCode = looksLikeCode(text);

  const loadFull = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(viewUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFull(await res.text());
    } catch {
      setLoadError('Failed to load the full message. Try again.');
    }
    setLoading(false);
  };

  return (
    <div>
      <div className={full ? 'max-h-[420px] overflow-auto rounded' : ''}>
        {asCode ? (
          <pre
            className={`text-xs sm:text-sm font-mono whitespace-pre overflow-x-auto ${
              mine ? '' : 'text-gray-900'
            }`}
          >
            {text}
          </pre>
        ) : (
          <div className="text-sm whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word' }}>
            {text}
          </div>
        )}
        {!full && <span className={mine ? 'text-blue-200' : 'text-gray-400'}>…</span>}
      </div>
      {loadError && <p className="mt-1 text-[11px] text-red-500">{loadError}</p>}
      <div className="flex items-center gap-3 mt-1.5">
        {!full && (
          <button
            type="button"
            onClick={loadFull}
            disabled={loading}
            className={`text-[11px] underline cursor-pointer ${
              mine ? 'text-blue-100 hover:text-white' : 'text-blue-600 hover:text-blue-700'
            } ${loading ? 'opacity-60' : ''}`}
          >
            {loading ? 'Loading…' : `Show full message (${formatFileSize(att.size)})`}
          </button>
        )}
        <a
          href={`${viewUrl}&download=1`}
          className={`inline-flex items-center gap-1 text-[11px] underline ${
            mine ? 'text-blue-100 hover:text-white' : 'text-gray-500 hover:text-gray-700'
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
      ? 'bg-blue-700/60 border-blue-500 hover:bg-blue-700'
      : 'bg-white border-gray-200 hover:bg-gray-50'
  }`;
  const inner = (
    <>
      <TypeIcon className={`w-7 h-7 shrink-0 ${mine ? 'text-blue-100' : 'text-gray-400'}`} />
      <span className="min-w-0 flex-1">
        <span className={`block text-xs font-medium truncate ${mine ? 'text-white' : 'text-gray-900'}`}>
          {attachment.name}
        </span>
        <span className={`block text-[10px] ${mine ? 'text-blue-200' : 'text-gray-500'}`}>
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
          <Download className={`w-4 h-4 shrink-0 ${mine ? 'text-blue-100' : 'text-gray-400'}`} />
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
