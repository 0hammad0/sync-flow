'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  collection,
  doc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import TextareaAutosize from 'react-textarea-autosize';
import {
  Bell,
  BellRing,
  ChevronDown,
  Clock,
  File as FileIcon,
  Film,
  Image as ImageIcon,
  LogOut,
  MessageCircle,
  Music,
  Paperclip,
  Plus,
  QrCode,
  RotateCcw,
  Send,
  Smile,
  Sparkles,
  Square,
  UploadCloud,
  UserPlus,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from 'lucide-react';
import { clientAuth, clientDb } from '@/shared/lib/firebase/client';
import { clientTimezone, formatTimeUntil } from '@/shared/lib/time';
import { directUpload } from '@/shared/lib/direct-upload';
import {
  cleanAiOutput,
  getAiAvailability,
  isAbortError,
  setAiRoom,
  streamAi,
  stripInlineMarkdown,
} from '@/features/ai/lib/ai-client';
import type { RewritePresetId } from '@/features/ai/lib/rewrite-presets';
import {
  formatFileSize,
  INLINE_TEXT_BYTES,
  LONG_TEXT_PREVIEW_CHARS,
  MAX_LONG_TEXT_BYTES,
} from '@/shared/lib/utils';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import QRModal from '@/features/files/components/QRModal';
import { MediaViewer } from '@/features/chat/components/MediaViewer';
import { MessageBubble, SystemNotice } from '@/features/chat/components/MessageBubble';
import {
  EMOJI_SET,
  HEARTBEAT_MS,
  MAX_ALBUM_FILES,
  MAX_ATTACHMENT_BYTES,
  MESSAGES_WINDOW,
  NOTIFY_KEY,
  ONLINE_WINDOW_MS,
  REWRITE_OPTIONS,
  SOUND_KEY,
  STORED_NAME_KEY,
  TYPING_THROTTLE_MS,
  byteLen,
  deviceIdHash,
  friendlyError,
  getAtts,
  getDeviceId,
  guestName,
  isCoarsePointer,
  nameForUser,
  playBeep,
  previewKind,
  readStorage,
  rememberRoom,
  toggleReactionLocal,
  writeStorage,
} from '@/features/chat/lib/chat-helpers';
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

// Rooms with at least this many earlier messages offer "Catch me up" on join.
const CATCH_UP_MIN_MESSAGES = 15;
// Expiry warnings: a banner at 10 minutes left, a louder one at 1 minute.
const EXPIRY_WARN_MS = 10 * 60_000;
const EXPIRY_URGENT_MS = 60_000;
const UPLOAD_BUSY_NOTE = 'An upload is already running — wait for it to finish, then add more.';

function joinedKey(code: string): string {
  return `syncflow.joined.${code}`;
}

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    /* sessionStorage blocked — join may be announced again, still correct */
  }
}

// This component only renders client-side (see ChatRoomLoader), so state
// initializers can read localStorage directly — no name-form flash.
export default function ChatRoom({ room, joinUrl }: ChatRoomProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [storedName] = useState(() => (readStorage(STORED_NAME_KEY) || '').trim().slice(0, 64));
  const [displayName, setDisplayName] = useState(storedName);
  // Pre-filled so joiners can enter with one tap; swapped for the email
  // prefix once auth resolves (unless the user already typed something).
  const [draftName, setDraftName] = useState(() => storedName || guestName());
  const [askingName, setAskingName] = useState(!storedName);
  const nameTouched = useRef(false);
  // Live expiry: the room doc is watched so an owner's "Extend" reaches everyone.
  const [expiresAt, setExpiresAt] = useState(room.expires_at);
  const [extending, setExtending] = useState(false);
  const [extendNote, setExtendNote] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  // Notifications: unread count in the tab title while hidden, optional beep,
  // browser notifications only after an explicit opt-in.
  const [hiddenUnread, setHiddenUnread] = useState(0);
  const [soundOn, setSoundOn] = useState(() => readStorage(SOUND_KEY) === '1');
  const [notifyOn, setNotifyOn] = useState(
    () =>
      readStorage(NOTIFY_KEY) === '1' &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
  );
  const [showAlertsMenu, setShowAlertsMenu] = useState(false);
  const [alertsNote, setAlertsNote] = useState<string | null>(null);
  // Unread while scrolled up: count on the jump button + a divider line.
  const [unseenCount, setUnseenCount] = useState(0);
  const [dividerId, setDividerId] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  // "Catch me up" offer for people arriving in a busy room. Only on a fresh
  // join this browser session, not on every reload.
  const [wasInRoom] = useState(() => readSession(joinedKey(room.code)) === '1');
  const [catchUpOffer, setCatchUpOffer] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  // Raw id: secret, sent only to our API. Firestore docs carry its hash, so
  // "is this mine" checks compare against deviceHash.
  const [deviceId] = useState(() => (typeof window === 'undefined' ? '' : getDeviceId()));
  const [deviceHash] = useState(() =>
    typeof window === 'undefined' ? '' : deviceIdHash(getDeviceId())
  );
  const [now, setNow] = useState(() => Date.now());
  const [presence, setPresence] = useState<ChatPresence[]>([]);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const [dragOver, setDragOver] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  // AI features (OpenRouter, Gemini fallback, via /api/ai) — aiTasks holds what the server
  // currently offers; controls for unavailable tasks are simply not rendered.
  const [aiTasks, setAiTasks] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [showJumpDown, setShowJumpDown] = useState(false);
  // Mobile: while typing, the tool buttons collapse behind a "+" that opens
  // a drop-up menu (emoji / AI / attach), so the input gets the width.
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [preRewriteDraft, setPreRewriteDraft] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingBeat = useRef(0);
  const dragCounter = useRef(0);
  // True while sendLongText or uploadFilesAsPending runs. A ref (not
  // uploadPercent state) so two calls in the same tick still see it.
  const uploadBusy = useRef(false);
  const summaryAbort = useRef<AbortController | null>(null);
  const rewriteAbort = useRef<AbortController | null>(null);
  // Snapshot-callback state (the listener is set up once per room, so it
  // reads current values through refs instead of re-subscribing).
  const knownIds = useRef<Set<string> | null>(null);
  const stickToBottom = useRef(true);
  const displayNameRef = useRef(displayName);
  const askingNameRef = useRef(askingName);
  const soundOnRef = useRef(soundOn);
  const notifyOnRef = useRef(notifyOn);
  const leavingRef = useRef(false);
  const ownPresenceSeen = useRef(false);
  useEffect(() => {
    displayNameRef.current = displayName;
    askingNameRef.current = askingName;
    soundOnRef.current = soundOn;
    notifyOnRef.current = notifyOn;
  }, [displayName, askingName, soundOn, notifyOn]);

  // AI requests must name a live room (server-side check in /api/ai).
  useEffect(() => {
    setAiRoom(room.code);
    return () => setAiRoom(null);
  }, [room.code]);

  // "Recent rooms" in the lobby — remember this visit (and any extension).
  useEffect(() => {
    rememberRoom({ code: room.code, name: room.name, expires_at: expiresAt });
  }, [room.code, room.name, expiresAt]);

  // Watch the room doc: picks up "Extend" from the owner in real time.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(clientDb(), 'rooms', room.code),
      (snap) => {
        const next = (snap.data() as Partial<ChatRoomType> | undefined)?.expires_at;
        if (typeof next === 'string') setExpiresAt(next);
      },
      () => {} // best effort — the prop value still drives the countdown
    );
    return () => unsub();
  }, [room.code]);

  // Discover which AI tasks the server offers (empty set → no AI controls).
  useEffect(() => {
    let cancelled = false;
    getAiAvailability().then((a) => {
      if (!cancelled) setAiTasks(new Set(a.tasks));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hide the site footer and lock body scroll while the chat room is mounted.
  useEffect(() => {
    document.body.classList.add('chat-open');
    return () => document.body.classList.remove('chat-open');
  }, []);

  // Auth listener — signed-in users get their email prefix as the suggested
  // name, unless a name is already stored or they've started typing one.
  useEffect(() => {
    const unsub = onAuthStateChanged(clientAuth(), (u) => {
      setUser(u);
      if (!readStorage(STORED_NAME_KEY) && !nameTouched.current && u?.email) {
        setDraftName(nameForUser(u));
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
    const isMine = (m: ChatMessage) =>
      m.sender_device_id
        ? m.sender_device_id === deviceHash
        : m.sender_name === displayNameRef.current;
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: ChatMessage[] = snap.docs.map((d) => d.data() as ChatMessage);
        const el = scrollRef.current;
        // Measured BEFORE the new messages render: were we at the bottom?
        const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 200;

        if (knownIds.current === null) {
          // First snapshot: history, not news. Offer a recap in busy rooms.
          const earlier = next.filter((m) => m.kind !== 'system').length;
          if (!wasInRoom && earlier >= CATCH_UP_MIN_MESSAGES) setCatchUpOffer(true);
          stickToBottom.current = true;
        } else {
          const known = knownIds.current;
          const added = next.filter((m) => !known.has(m.id));
          const incoming = added.filter((m) => m.kind !== 'system' && !isMine(m));
          // My own new message always scrolls into view.
          stickToBottom.current = nearBottom || added.some((m) => m.kind !== 'system' && isMine(m));
          if (incoming.length > 0) {
            const hidden = document.hidden;
            if (!stickToBottom.current) setUnseenCount((n) => n + incoming.length);
            if (!stickToBottom.current || hidden) {
              setDividerId((cur) => cur ?? incoming[0].id);
            }
            if (hidden) setHiddenUnread((n) => n + incoming.length);
            if (soundOnRef.current && (hidden || !document.hasFocus())) playBeep();
            if (notifyOnRef.current && hidden) {
              const last = incoming[incoming.length - 1];
              try {
                const n = new Notification(room.name || 'Chat room', {
                  body: `${last.sender_name}: ${last.content.slice(0, 120) || 'sent a file'}`,
                  tag: `syncflow-${room.code}`,
                });
                n.onclick = () => {
                  window.focus();
                  n.close();
                };
              } catch {
                /* mobile browsers need a service worker for this — skip */
              }
            }
          }
        }
        knownIds.current = new Set(next.map((m) => m.id));
        setMessages(next);
        setLoadingMessages(false);
      },
      (err) => {
        console.error('Chat snapshot error:', err);
        setLoadingMessages(false);
      }
    );
    return () => unsub();
  }, [room.code, room.name, deviceHash, wasInRoom]);

  // Tab title shows the unread count while the tab is in the background;
  // coming back clears it.
  useEffect(() => {
    const original = document.title;
    const onVisible = () => {
      if (!document.hidden) setHiddenUnread(0);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.title = original;
    };
  }, []);
  useEffect(() => {
    const base = room.name || 'Chat room';
    document.title = hiddenUnread > 0 ? `(${hiddenUnread}) ${base}` : base;
  }, [hiddenUnread, room.name]);

  // Jump straight to the newest messages when the room first loads.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (loadingMessages || didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    didInitialScroll.current = true;
  }, [loadingMessages, messages]);

  // Auto-scroll to bottom only when a NEW message is appended and the user was
  // at the bottom (or sent it) — decided in the snapshot callback before the
  // new content changed the scroll height. In-place updates like reactions
  // must NOT scroll, otherwise reacting to a message jumps the view.
  const scrollMetaRef = useRef({ len: 0, lastId: '' });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const lastId = messages.length ? messages[messages.length - 1].id : '';
    const prev = scrollMetaRef.current;
    const appended = messages.length > prev.len || (lastId !== '' && lastId !== prev.lastId);
    scrollMetaRef.current = { len: messages.length, lastId };
    if (!appended) return; // reaction / edit — leave the scroll position alone
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Periodic tick for the "expires in" countdown — every 30s normally, every
  // 5s in the last minutes so the expiry warnings land on time.
  const msLeft = new Date(expiresAt).getTime() - now;
  const finalMinutes = msLeft <= EXPIRY_WARN_MS + 60_000;
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), finalMinutes ? 5_000 : 30_000);
    return () => clearInterval(id);
  }, [finalMinutes]);

  // Lock page scroll while the chat UI is shown — the chat is a fixed,
  // self-scrolling screen; without this the page itself can still scroll
  // and rubber-band on phones. Locks <html>, not <body>: the modals manage
  // body overflow themselves and would clobber a body-level lock.
  useEffect(() => {
    if (askingName) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = 'hidden';
    return () => {
      el.style.overflow = prev;
    };
  }, [askingName]);

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

  // POST a join announcement. The server skips the "joined" notice when this
  // device is already online (e.g. a second tab), unless `rejoin` says we were
  // just timed out.
  const announceJoin = useCallback(
    (name: string, rejoin = false) => {
      writeSession(joinedKey(room.code), '1');
      void fetch(`/api/chat/${room.code}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'join',
          senderName: name,
          tz: clientTimezone(),
          deviceId: getDeviceId(),
          rejoin,
        }),
      }).catch(() => {});
    },
    [room.code]
  );

  // Real-time presence subscription (typing / online).
  useEffect(() => {
    const unsub = onSnapshot(
      collection(clientDb(), 'rooms', room.code, 'presence'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as ChatPresence);
        setPresence(list);
        // Our own presence doc vanished after we'd been online: the server
        // timed us out (tab was asleep) and posted "left". Say hello again.
        const mineOnline = list.some((p) => p.device_id === deviceHash);
        if (mineOnline) {
          ownPresenceSeen.current = true;
        } else if (ownPresenceSeen.current && !leavingRef.current) {
          ownPresenceSeen.current = false;
          writeSession(joinedKey(room.code), null);
          // On the name screen, the join effect announces once a name is set.
          if (!askingNameRef.current && displayNameRef.current) {
            announceJoin(displayNameRef.current, true);
          }
        }
      },
      () => {} // presence is best-effort; chat works without it
    );
    return () => unsub();
  }, [room.code, deviceHash, announceJoin]);

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

  // Keep-alive beats while in the room (one tiny write per 25s). On a fresh
  // join the join POST creates presence itself — beating first would make the
  // server think we're already online and skip the "joined" notice.
  useEffect(() => {
    if (askingName || !displayName) return;
    if (readSession(joinedKey(room.code)) === '1') sendHeartbeat();
    const id = setInterval(() => sendHeartbeat(), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [askingName, displayName, sendHeartbeat, room.code]);

  // Others online/typing — derived locally from timestamps, zero extra I/O.
  const othersPresent = useMemo(
    () => presence.filter((p) => p.device_id !== deviceHash),
    [presence, deviceHash]
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
  // matching WhatsApp mobile. Fine pointers (mouse/trackpad): Enter sends.
  // Pointer type, not touch support — touchscreen laptops still use a mouse.
  const [isTouch] = useState(isCoarsePointer);

  // Announce join once per room per browser session (WhatsApp-style system
  // message). The flag survives reloads, so refreshing doesn't post
  // "left"/"joined". "Left" is only posted by the Leave button or by the
  // server's heartbeat timeout — never on pagehide.
  useEffect(() => {
    if (askingName || !displayName) return;
    if (readSession(joinedKey(room.code)) === '1') return;
    announceJoin(displayName);
  }, [askingName, displayName, room.code, announceJoin]);

  // Explicit leave: announce it, drop presence, and go back to the lobby.
  const handleLeave = useCallback(() => {
    leavingRef.current = true;
    writeSession(joinedKey(room.code), null);
    if (displayName) {
      void fetch(`/api/chat/${room.code}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // keepalive: the request must survive the navigation below.
        keepalive: true,
        body: JSON.stringify({
          event: 'leave',
          senderName: displayName,
          tz: clientTimezone(),
          deviceId: getDeviceId(),
        }),
      }).catch(() => {});
    }
    router.push('/chat');
  }, [displayName, room.code, router]);

  const timeRemaining = useMemo(() => {
    void now; // dep so it re-renders
    return formatTimeUntil(expiresAt);
  }, [expiresAt, now]);

  const isOwner = !!user && !!room.created_by && room.created_by === user.uid;

  // Owner-only: +24h (server caps total lifetime at 7 days).
  const extendRoom = useCallback(async () => {
    if (extending) return;
    setExtending(true);
    setExtendNote(null);
    try {
      const res = await fetch(`/api/chat/${room.code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extend' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(friendlyError(data.error, res.status));
      setExpiresAt(data.expiresAt);
      setWarningDismissed(false);
      setExtendNote(`Extended. Now expires in ${formatTimeUntil(data.expiresAt)}.`);
    } catch (err) {
      setExtendNote(friendlyError(err));
    }
    setExtending(false);
  }, [extending, room.code]);

  // Invite: the native share sheet on phones, copy-link elsewhere.
  const handleInvite = useCallback(async () => {
    if (isTouch && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: room.name || 'Chat room', url: joinUrl });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // share failed for another reason — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(joinUrl);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      window.prompt('Copy this link to invite people:', joinUrl);
    }
  }, [isTouch, joinUrl, room.name]);

  // Alerts: the beep is a plain local toggle; browser notifications need the
  // permission prompt, which only ever runs from this explicit click.
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writeStorage(SOUND_KEY, next ? '1' : null);
    if (next) playBeep(); // preview + unlocks audio on iOS
  };
  const toggleNotify = async () => {
    setAlertsNote(null);
    if (notifyOn) {
      setNotifyOn(false);
      writeStorage(NOTIFY_KEY, null);
      return;
    }
    if (typeof Notification === 'undefined') {
      setAlertsNote('This browser doesn\'t support notifications.');
      return;
    }
    const permission =
      Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== 'granted') {
      setAlertsNote('Notifications are blocked. Allow them in your browser settings.');
      return;
    }
    setNotifyOn(true);
    writeStorage(NOTIFY_KEY, '1');
  };

  const handlePickName = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = draftName.trim().slice(0, 64);
    if (!cleaned) return;
    setDisplayName(cleaned);
    setAskingName(false);
    writeStorage(STORED_NAME_KEY, cleaned);
  };

  // Big typed message: Firestore docs cap at 1MB, so the body goes to R2 as a
  // text file and the bubble shows a preview with "Show full message".
  // Direct-to-R2 (presign → PUT → complete) so bodies over the hosting
  // request cap (~4.5 MB on Vercel) still go through. The caller has already
  // checked the size against MAX_LONG_TEXT_BYTES.
  const sendLongText = useCallback(
    (content: string) => {
      if (uploadBusy.current) {
        setSendError(UPLOAD_BUSY_NOTE);
        return;
      }
      uploadBusy.current = true;
      setSendError(null);
      setUploadPercent(0);

      const file = new File([content], 'long-message.txt', { type: 'text/plain' });
      // Captured now: the user may keep typing (or pick another reply)
      // while the body uploads.
      const caption = content.slice(0, LONG_TEXT_PREVIEW_CHARS);
      const sentReplyId = replyTo?.id ?? null;

      void directUpload({
        presignUrl: `/api/chat/${room.code}/attachments/presign`,
        presignBody: {
          originalName: file.name,
          size: file.size,
          mimeType: 'text/plain',
          longText: true,
        },
        blob: file,
        completeUrl: `/api/chat/${room.code}/attachments`,
        completeBody: (ticket) => ({
          ticket,
          senderName: displayName,
          caption,
          tz: clientTimezone(),
          deviceId,
          replyToId: sentReplyId,
        }),
        onProgress: setUploadPercent,
      }).then((res) => {
        uploadBusy.current = false;
        setUploadPercent(null);
        if (res.success) {
          // Clear only what was sent — keep text typed or a reply picked
          // during the upload.
          setDraft((d) => (d === content ? '' : d));
          setReplyTo((r) => (r?.id === sentReplyId ? null : r));
        } else {
          setSendError(friendlyError(res.error || 'Upload failed.'));
        }
      });
    },
    [displayName, room.code, replyTo, deviceId]
  );

  // Store one file in R2 (no message yet) with progress; resolves to its
  // metadata. Albums upload each file separately so per-request limits never
  // apply to the batch.
  const uploadOneFile = useCallback(
    async (file: File, onProgress: (loaded: number) => void): Promise<ChatAttachment> => {
      const res = await directUpload({
        presignUrl: `/api/chat/${room.code}/attachments/presign`,
        presignBody: {
          originalName: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
        },
        blob: file,
        completeUrl: `/api/chat/${room.code}/attachments`,
        completeBody: (ticket) => ({
          ticket,
          senderName: displayName,
          tz: clientTimezone(),
          deviceId,
          uploadOnly: true,
        }),
        onProgress: (percent) => onProgress(Math.round((percent / 100) * file.size)),
      });
      // The attachment carries a server `proof` field; it rides along to
      // /messages, which only accepts files with a valid proof.
      if (res.success && res.attachment) return res.attachment as ChatAttachment;
      throw new Error(res.error || 'Upload failed. Please try again.');
    },
    [displayName, deviceId, room.code]
  );

  // Upload files to R2 without sending — stores them as pending attachments
  // so the user can add a caption and send explicitly. Drop, paste and the
  // file picker all land here.
  const uploadFilesAsPending = useCallback(
    async (files: File[]) => {
      // One batch at a time: an overlapping run would clear the progress bar
      // (re-enabling Send) while the other is still uploading.
      if (uploadBusy.current) {
        setSendError(UPLOAD_BUSY_NOTE);
        return;
      }
      const notes: string[] = [];
      const sized = files.filter((f) => {
        if (f.size === 0) notes.push(`"${f.name}" is empty — skipped.`);
        else if (f.size > MAX_ATTACHMENT_BYTES) {
          notes.push(
            `"${f.name}" is ${formatFileSize(f.size)} — over ${formatFileSize(MAX_ATTACHMENT_BYTES)}, skipped.`
          );
        } else return true;
        return false;
      });
      // Cap BEFORE uploading so nothing is uploaded only to be dropped.
      const freeSlots = Math.max(0, MAX_ALBUM_FILES - pendingAttachments.length);
      const valid = sized.slice(0, freeSlots);
      const skipped = sized.length - valid.length;
      if (skipped > 0) {
        notes.push(
          `One message holds up to ${MAX_ALBUM_FILES} files — ${skipped} ${skipped === 1 ? 'file was' : 'files were'} skipped.`
        );
      }
      setSendError(notes.length > 0 ? notes.join(' ') : null);
      if (valid.length === 0) return;

      uploadBusy.current = true;
      const totalBytes = valid.reduce((s, f) => s + f.size, 0);
      let doneBytes = 0;
      let doneCount = 0;
      setUploadPercent(0);
      setUploadLabel(valid.length > 1 ? `Uploading 1/${valid.length}` : 'Uploading');
      try {
        for (let i = 0; i < valid.length; i++) {
          setUploadLabel(valid.length > 1 ? `Uploading ${i + 1}/${valid.length}` : 'Uploading');
          const meta = await uploadOneFile(valid[i], (loaded) => {
            setUploadPercent(Math.round(((doneBytes + loaded) / totalBytes) * 100));
          });
          doneBytes += valid[i].size;
          doneCount++;
          setUploadPercent(Math.round((doneBytes / totalBytes) * 100));
          // Keep each file as soon as it's stored, so a later failure (e.g. a
          // 429 on presign) doesn't throw away the ones already uploaded.
          setPendingAttachments((prev) => [...prev, meta].slice(0, MAX_ALBUM_FILES));
        }
        textareaRef.current?.focus();
      } catch (err) {
        const kept =
          doneCount > 0 ? ` ${doneCount} of ${valid.length} files were uploaded and kept.` : '';
        setSendError([...notes, friendlyError(err) + kept].join(' '));
      } finally {
        uploadBusy.current = false;
        setUploadPercent(null);
        setUploadLabel(null);
      }
    },
    [uploadOneFile, pendingAttachments.length]
  );

  // Drag-and-drop handlers for the chat container.
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter.current += 1;
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragOver(false);
      if (timeRemaining === 'expired') return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) void uploadFilesAsPending(files);
    },
    [timeRemaining, uploadFilesAsPending]
  );

  const handleSend = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (sending || uploadPercent !== null) return;
      const content = draft;

      // Album send: pending attachments (from drag-drop or file picker) with
      // optional caption. Takes priority over plain text so the user can also
      // type a caption before hitting send.
      if (pendingAttachments.length > 0) {
        // Files added while this send is in flight must survive it.
        const sentKeys = new Set(pendingAttachments.map((a) => a.key));
        setSending(true);
        setSendError(null);
        try {
          const res = await fetch(`/api/chat/${room.code}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              senderName: displayName,
              content: content.trim(),
              tz: clientTimezone(),
              deviceId,
              attachments: pendingAttachments,
              ...(replyTo ? { replyToId: replyTo.id } : {}),
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            setSendError(friendlyError(data.error || `HTTP ${res.status}`, res.status));
            return;
          }
          // Keep anything typed while the send was in flight.
          setDraft((d) => (d === content ? '' : d));
          setPendingAttachments((prev) => prev.filter((a) => !sentKeys.has(a.key)));
          setShowEmoji(false);
          setReplyTo(null);
          setDividerId(null);
          setUnseenCount(0);
          lastTypingBeat.current = 0;
          sendHeartbeat(false);
        } catch (err) {
          setSendError(friendlyError(err));
        } finally {
          setSending(false);
          // Keep the keyboard up on phones for the next message.
          textareaRef.current?.focus();
        }
        return;
      }

      if (!content.trim()) return;
      const bytes = byteLen(content);
      if (bytes > MAX_LONG_TEXT_BYTES) {
        setSendError('Message is too long (limit 15 MB).');
        return;
      }
      // Big text: Firestore docs cap at 1MB, so the body goes to R2 and the
      // bubble shows a preview with "Show full message". Same send button,
      // invisible to the user.
      if (bytes > INLINE_TEXT_BYTES) {
        sendLongText(content);
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
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          setSendError(friendlyError(data.error || `HTTP ${res.status}`, res.status));
          return;
        }
        // Keep anything typed while the send was in flight.
        setDraft((d) => (d === content ? '' : d));
        setShowEmoji(false);
        setReplyTo(null);
        setDividerId(null);
        setUnseenCount(0);
        lastTypingBeat.current = 0;
        sendHeartbeat(false); // clear the typing flag immediately
        // The onSnapshot will deliver the new message; we don't optimistically
        // insert to avoid duplicate-render flicker.
      } catch (err) {
        setSendError(friendlyError(err));
      } finally {
        setSending(false);
        // The textarea stays enabled while sending (disabling it blurs it and
        // drops the phone keyboard); refocus in case the Send tap moved focus.
        textareaRef.current?.focus();
      }
    },
    [draft, pendingAttachments, uploadPercent, displayName, room.code, sending, replyTo, deviceId, sendHeartbeat, sendLongText]
  );

  /* ------------------------------ AI helpers ----------------------------- */

  // Plain-text transcript of the latest chat messages for AI prompts.
  const buildTranscript = useCallback(
    (maxMessages: number) =>
      messages
        .filter((m) => m.kind !== 'system')
        .slice(-maxMessages)
        .map((m) => {
          const atts = getAtts(m);
          const files =
            atts.length > 0 && !atts[0].is_long_text
              ? ` [shared ${atts.length === 1 ? 'a file' : `${atts.length} files`}: ${atts.map((a) => a.name).join(', ')}]`
              : '';
          return `${m.sender_name}: ${m.content}${files}`;
        })
        .join('\n')
        .slice(-14_000),
    [messages]
  );

  // Smart replies: 3 tappable suggestions from the recent conversation.
  const suggestReplies = useCallback(async () => {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestions([]);
    setSendError(null);
    try {
      const text = await streamAi({
        task: 'replies',
        transcript: buildTranscript(12),
        me: displayName,
      });
      const parsed = cleanAiOutput(text)
        .split('\n')
        .map((s) => s.replace(/^[-*\d.)"'\s]+/, '').replace(/["']+$/, '').trim())
        // Drop preamble/label lines the model sneaks in ("Here are 3 replies:").
        .filter((s) => s && !s.endsWith(':') && !/^(here (are|is)|suggested|repl(y|ies))/i.test(s))
        .slice(0, 3);
      setSuggestions(parsed);
      if (parsed.length === 0) setSendError('No suggestions this time. Try again.');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'AI is unavailable right now.');
    }
    setSuggesting(false);
  }, [suggesting, buildTranscript, displayName]);

  // "Catch me up": streamed room summary shown in a dismissible panel.
  // Stop keeps whatever has streamed so far.
  const catchMeUp = useCallback(async () => {
    if (summarizing) return;
    setCatchUpOffer(false);
    setSummarizing(true);
    setSummary('');
    setSummaryExpanded(false);
    const ctrl = new AbortController();
    summaryAbort.current = ctrl;
    try {
      await streamAi(
        { task: 'summary', transcript: buildTranscript(80) },
        (t) => setSummary(t),
        ctrl.signal
      );
    } catch (err) {
      if (isAbortError(err)) {
        setSummary((cur) => (cur ? cur : null));
      } else {
        setSummary(`⚠ ${err instanceof Error ? err.message : 'AI is unavailable right now.'}`);
      }
    }
    summaryAbort.current = null;
    setSummarizing(false);
  }, [summarizing, buildTranscript]);

  // Rewrite the draft in place, streaming into the textarea; undoable.
  // Stop restores the original draft.
  const applyRewrite = useCallback(
    async (preset: RewritePresetId) => {
      const original = draft;
      if (!original.trim() || rewriting) return;
      setShowAiPanel(false);
      setRewriting(true);
      setPreRewriteDraft(original);
      setSendError(null);
      setDraft('');
      const ctrl = new AbortController();
      rewriteAbort.current = ctrl;
      try {
        const result = await streamAi(
          { task: 'rewrite', text: original, preset },
          (t) => setDraft(t),
          ctrl.signal
        );
        const cleaned = cleanAiOutput(result);
        // An empty or refused rewrite should never eat the draft.
        setDraft(cleaned || original);
        if (!cleaned) setPreRewriteDraft(null);
      } catch (err) {
        setDraft(original);
        setPreRewriteDraft(null);
        if (!isAbortError(err)) {
          setSendError(err instanceof Error ? err.message : 'AI is unavailable right now.');
        }
      }
      rewriteAbort.current = null;
      setRewriting(false);
      textareaRef.current?.focus();
    },
    [draft, rewriting]
  );

  // Abort any in-flight AI stream when leaving the room.
  useEffect(
    () => () => {
      summaryAbort.current?.abort();
      rewriteAbort.current?.abort();
    },
    []
  );

  /* ----------------------------------------------------------------------- */

  // Throttled typing beat: at most one write per 2.5s while actually typing.
  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    // Typing (or clearing) closes the mobile drop-up menu.
    setShowToolsMenu(false);
    if (value.trim() && Date.now() - lastTypingBeat.current > TYPING_THROTTLE_MS) {
      lastTypingBeat.current = Date.now();
      sendHeartbeat(true);
    }
  };

  // Paste images/files straight into the composer → same pending-upload
  // path as the file picker and drag-drop. Plain-text pastes are untouched.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0 || timeRemaining === 'expired') return;
    e.preventDefault();
    void uploadFilesAsPending(files);
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

  // Toggle a reaction. Apply it optimistically so the pill appears instantly,
  // then POST; the onSnapshot listener later confirms with the authoritative
  // state (which matches). On failure we restore the prior reactions.
  const handleToggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const reactor = { id: deviceHash, name: displayName };
      let prevReactions: ChatMessage['reactions'];
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          prevReactions = m.reactions;
          return { ...m, reactions: toggleReactionLocal(m.reactions, emoji, reactor) };
        })
      );
      try {
        const res = await fetch(`/api/chat/${room.code}/reactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, emoji, senderName: displayName, deviceId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        // Roll back the optimistic change; a later snapshot reconciles anyway.
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions: prevReactions } : m))
        );
      }
    },
    [room.code, displayName, deviceId, deviceHash]
  );

  const handleStartReply = useCallback((m: ChatMessage) => {
    setReplyTo(m);
    textareaRef.current?.focus();
  }, []);

  // Attachments the in-chat viewer can show, in chat order (albums are
  // flattened) — prev/next navigates this list, WhatsApp media-viewer style.
  const viewableAttachments = useMemo(() => {
    const items: { att: ChatAttachment; sender: string }[] = [];
    for (const m of messages) {
      if (m.kind === 'system') continue;
      for (const att of getAtts(m)) {
        if (!att.is_long_text && previewKind(att) !== null) {
          items.push({ att, sender: m.sender_name });
        }
      }
    }
    return items;
  }, [messages]);
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
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) void uploadFilesAsPending(files);
    e.target.value = ''; // allow re-picking the same files
  };

  const hasChat = messages.some((m) => m.kind !== 'system');
  const lastMessage = messages[messages.length - 1];
  // Smart-reply chip: the newest message is someone else's chat message.
  const showReplyChip =
    aiTasks.has('replies') &&
    !!lastMessage &&
    lastMessage.kind !== 'system' &&
    (lastMessage.sender_device_id
      ? lastMessage.sender_device_id !== deviceHash
      : lastMessage.sender_name !== displayName) &&
    !suggesting &&
    suggestions.length === 0 &&
    timeRemaining !== 'expired';

  if (askingName) {
    return (
      <div className="max-w-sm mx-auto px-4 py-12 animate-fade-in">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">
          {room.name ? `Join ${room.name}` : 'Join the room'}
        </h1>
        <p className="text-sm text-fg-muted mb-4">
          Others will see this name on your messages. Change it or just tap Enter.
        </p>
        <form onSubmit={handlePickName} className="space-y-3">
          <input
            // No autofocus on phones: it would pop the keyboard over the
            // one-tap Enter button.
            autoFocus={!isTouch}
            onFocus={(e) => e.currentTarget.select()}
            type="text"
            value={draftName}
            onChange={(e) => {
              nameTouched.current = true;
              setDraftName(e.target.value);
            }}
            maxLength={64}
            placeholder="Your name"
            // 16px on mobile — anything smaller makes iOS Safari zoom the
            // page when the field is focused (and it stays zoomed).
            className="input-base w-full px-3 py-2.5 text-base sm:text-sm"
          />
          <button
            type="submit"
            disabled={!draftName.trim()}
            className={`w-full py-2.5 rounded-xl text-white text-sm font-medium transition-all duration-200 ${
              draftName.trim()
                ? 'bg-flow hover:brightness-110 hover:shadow-[var(--glow)] cursor-pointer btn-hover'
                : 'bg-surface-3 text-fg-faint cursor-not-allowed'
            }`}
          >
            Enter room
          </button>
        </form>
        <p className="mt-3 text-xs text-fg-faint">
          Saved locally so you don&apos;t have to enter it next time.
        </p>
      </div>
    );
  }

  return (
    // position:fixed takes the chat out of the document flow entirely — the
    // body's min-h-screen otherwise leaves the PAGE scrollable on phones
    // (100vh > visible height while browser toolbars are shown).
    <div
      className="fixed inset-x-0 bottom-0 top-[var(--site-header-h,3.75rem)] flex flex-col overflow-hidden animate-fade-in bg-canvas"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="relative flex flex-col flex-1 min-h-0 w-full max-w-2xl mx-auto bg-surface sm:my-4 sm:border sm:border-edge sm:rounded-3xl sm:shadow-[var(--shadow-card)] overflow-hidden">
        {/* Drop zone overlay */}
        {dragOver && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-canvas/85 backdrop-blur-sm pointer-events-none animate-fade-in rounded-3xl">
            <div className="flex items-center justify-center w-20 h-20 rounded-3xl bg-brand/10 border-2 border-dashed border-brand/50">
              <UploadCloud className="w-10 h-10 text-brand-text" />
            </div>
            <p className="text-base font-semibold text-fg">Drop to upload</p>
            <p className="text-sm text-fg-muted">Files will be attached to your message</p>
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-edge bg-surface-2/80">
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-base font-semibold tracking-tight text-fg truncate leading-tight">
              {room.name || 'Chat room'}
            </h1>
            <p className="text-[11px] sm:text-xs text-fg-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <span className="font-mono tracking-wider sm:tracking-widest text-brand-text whitespace-nowrap">
                {room.code}
              </span>
              <span className="text-fg-faint/50 max-sm:hidden">|</span>
              {typingOthers.length > 0 ? (
                <span className="text-success-text font-medium truncate min-w-0 max-w-full">
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
                      onlineOthers.length > 0 ? 'bg-success' : 'bg-fg-faint/40'
                    }`}
                  />
                  {onlineOthers.length + 1} online
                </span>
              )}
              <span className="text-fg-faint/50 max-sm:hidden">|</span>
              <span
                className="whitespace-nowrap"
                title={`Expires ${new Date(expiresAt).toLocaleString()}`}
              >
                {timeRemaining === 'expired' ? (
                  <span className="text-danger-text font-medium">expired</span>
                ) : (
                  <span className="text-fg-muted">expires in {timeRemaining}</span>
                )}
              </span>
            </p>
          </div>
          <div className="relative flex items-center gap-1.5 sm:gap-2 shrink-0">
            {aiTasks.has('summary') && (
              <button
                onClick={catchMeUp}
                disabled={summarizing || messages.filter((m) => m.kind !== 'system').length === 0}
                className="p-2 bg-surface border border-edge text-fg-muted rounded-lg hover:bg-surface-3 hover:text-fg cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Catch me up — AI summary of the conversation"
                aria-label="Catch me up with an AI summary"
              >
                <Sparkles className={`w-4 h-4 ${summarizing ? 'animate-pulse text-brand-text' : ''}`} />
              </button>
            )}
            <button
              onClick={() => void handleInvite()}
              className={`p-2 bg-surface border border-edge rounded-lg hover:bg-surface-3 cursor-pointer transition-colors ${
                inviteCopied ? 'text-success-text' : 'text-fg-muted hover:text-fg'
              }`}
              title={inviteCopied ? 'Link copied' : 'Invite people'}
              aria-label={inviteCopied ? 'Invite link copied' : 'Invite people'}
            >
              <UserPlus className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowQR(true)}
              className="p-2 bg-surface border border-edge text-fg-muted rounded-lg hover:bg-surface-3 hover:text-fg cursor-pointer transition-colors max-sm:hidden"
              title="Show QR code for joining"
              aria-label="Show QR code for joining"
            >
              <QrCode className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowAlertsMenu((v) => !v)}
              className={`p-2 bg-surface border border-edge rounded-lg hover:bg-surface-3 cursor-pointer transition-colors ${
                showAlertsMenu || notifyOn || soundOn ? 'text-brand-text' : 'text-fg-muted hover:text-fg'
              }`}
              title="Alerts"
              aria-label="Alert settings"
              aria-expanded={showAlertsMenu}
            >
              {notifyOn ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            </button>
            <button
              onClick={handleLeave}
              className="p-2 bg-surface border border-edge text-fg-muted rounded-lg hover:bg-danger/10 hover:text-danger-text cursor-pointer transition-colors"
              title="Leave room"
              aria-label="Leave room"
            >
              <LogOut className="w-4 h-4" />
            </button>

            {showAlertsMenu && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setShowAlertsMenu(false)}
                  aria-hidden="true"
                />
                <div className="absolute top-full right-0 mt-2 z-30 w-64 p-1.5 flex flex-col gap-0.5 bg-surface border border-edge rounded-xl shadow-lg animate-fade-in-scale">
                  <button
                    type="button"
                    onClick={() => void toggleNotify()}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-fg rounded-lg hover:bg-surface-2 cursor-pointer text-left transition-colors"
                    aria-pressed={notifyOn}
                  >
                    {notifyOn ? (
                      <BellRing className="w-4 h-4 text-brand-text" />
                    ) : (
                      <Bell className="w-4 h-4 text-fg-muted" />
                    )}
                    <span className="flex-1">Notifications</span>
                    <span className="text-xs text-fg-faint">{notifyOn ? 'On' : 'Off'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={toggleSound}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-fg rounded-lg hover:bg-surface-2 cursor-pointer text-left transition-colors"
                    aria-pressed={soundOn}
                  >
                    {soundOn ? (
                      <Volume2 className="w-4 h-4 text-brand-text" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-fg-muted" />
                    )}
                    <span className="flex-1">Sound</span>
                    <span className="text-xs text-fg-faint">{soundOn ? 'On' : 'Off'}</span>
                  </button>
                  {isOwner && timeRemaining !== 'expired' && (
                    <button
                      type="button"
                      onClick={() => void extendRoom()}
                      disabled={extending}
                      className="flex items-center gap-2.5 px-3 py-2 text-sm text-fg rounded-lg hover:bg-surface-2 cursor-pointer text-left transition-colors disabled:opacity-50"
                    >
                      <Clock className="w-4 h-4 text-fg-muted" />
                      <span className="flex-1">{extending ? 'Extending…' : 'Extend 24 hours'}</span>
                    </button>
                  )}
                  {(alertsNote || extendNote) && (
                    <p className="px-3 py-1.5 text-xs text-fg-muted">{alertsNote || extendNote}</p>
                  )}
                  <p className="px-3 pt-1 pb-1.5 text-[11px] text-fg-faint">
                    Alerts fire only while this tab is in the background.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Expiry warning — 10 minutes, then 1 minute left. */}
        {msLeft > 0 && msLeft <= EXPIRY_WARN_MS && (msLeft <= EXPIRY_URGENT_MS || !warningDismissed) && (
          <div
            className={`flex items-center gap-2 px-4 py-2 text-xs border-b animate-fade-in ${
              msLeft <= EXPIRY_URGENT_MS
                ? 'bg-danger/10 border-danger/20 text-danger-text'
                : 'bg-warning/10 border-warning/20 text-warning-text'
            }`}
            role="status"
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 min-w-0">
              {msLeft <= EXPIRY_URGENT_MS
                ? 'This room closes in less than a minute.'
                : `This room closes in ${Math.ceil(msLeft / 60_000)} minutes.`}
              {!isOwner && !room.created_by && ' Rooms created without signing in can\'t be extended.'}
              {extendNote && ` ${extendNote}`}
            </span>
            {isOwner && (
              <button
                type="button"
                onClick={() => void extendRoom()}
                disabled={extending}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-surface border border-edge text-fg font-medium hover:bg-surface-2 cursor-pointer disabled:opacity-50"
              >
                {extending ? 'Extending…' : 'Extend 24h'}
              </button>
            )}
            {msLeft > EXPIRY_URGENT_MS && (
              <button
                type="button"
                onClick={() => setWarningDismissed(true)}
                className="shrink-0 p-1 rounded-lg hover:bg-surface-2 cursor-pointer"
                aria-label="Dismiss warning"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* AI room summary panel — collapsed to a teaser; "Read more" expands
            with a height animation and glow. */}
        {summary !== null && (
          <div
            className={`relative mx-2 sm:mx-4 mt-1.5 px-2.5 py-2 pr-8 bg-brand/5 border rounded-lg animate-fade-in transition-all duration-300 ${
              summaryExpanded ? 'border-brand/40 shadow-[var(--glow)]' : 'border-brand/20'
            }`}
          >
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand-text mb-0.5">
              <Sparkles className="w-3 h-3" />
              Catch me up
              {summarizing && (
                <>
                  <span className="font-normal normal-case tracking-normal text-fg-faint">thinking…</span>
                  <button
                    type="button"
                    onClick={() => summaryAbort.current?.abort()}
                    className="ml-1 flex items-center gap-0.5 font-medium normal-case tracking-normal text-fg-muted hover:text-fg underline underline-offset-2 cursor-pointer"
                  >
                    <Square className="w-2.5 h-2.5" />
                    Stop
                  </button>
                </>
              )}
            </p>
            <div
              className={`text-xs leading-snug whitespace-pre-wrap break-words text-fg-muted transition-[max-height] duration-300 ease-out ${
                summaryExpanded ? 'max-h-52 overflow-y-auto' : 'max-h-[2.7em] overflow-hidden'
              }`}
            >
              {stripInlineMarkdown(summary) || '…'}
            </div>
            {!summarizing && summary && (
              <button
                type="button"
                onClick={() => setSummaryExpanded((e) => !e)}
                className="mt-1 text-[10px] font-medium text-brand-text underline underline-offset-2 hover:opacity-80 cursor-pointer"
              >
                {summaryExpanded ? 'Show less' : 'Read more'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSummary(null)}
              className="absolute top-1.5 right-1.5 p-1 rounded-lg text-fg-faint hover:text-fg hover:bg-surface-2 cursor-pointer"
              aria-label="Dismiss summary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            setShowJumpDown(fromBottom > 300);
            if (fromBottom < 200) setUnseenCount(0);
          }}
          data-chat-scroll
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-2 sm:px-4 py-3 sm:py-4 space-y-3 bg-canvas/50"
          aria-live="polite"
        >
          {loadingMessages ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner size="md" className="text-fg-faint" />
            </div>
          ) : (
            <>
            {messages.map((m) => (
              <Fragment key={m.id}>
              {m.id === dividerId && (
                <div className="flex items-center gap-2 py-1" role="separator">
                  <span className="flex-1 h-px bg-brand/30" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-text">
                    New messages
                  </span>
                  <span className="flex-1 h-px bg-brand/30" />
                </div>
              )}
              {m.kind === 'system' ? (
                <SystemNotice message={m} />
              ) : (
                <MessageBubble
                  message={m}
                  // Per-device id is the identity; name-match is only the
                  // fallback for messages sent before device ids existed.
                  mine={
                    m.sender_device_id
                      ? m.sender_device_id === deviceHash
                      : m.sender_name === displayName
                  }
                  // Reactions are "mine" only by device id, never by name.
                  myDeviceHash={deviceHash}
                  roomCode={room.code}
                  highlighted={highlightId === m.id}
                  onReply={handleStartReply}
                  onToggleReaction={handleToggleReaction}
                  onQuoteClick={jumpToMessage}
                  onOpenViewer={handleOpenViewer}
                />
              )}
              </Fragment>
            ))}
            {/* Nobody has said anything yet (join notices only) → invite. */}
            {!hasChat && (
              <div className="flex flex-col items-center justify-center text-center px-6 py-10">
                <MessageCircle className="w-10 h-10 mb-3 text-fg-faint/50" />
                <p className="text-sm font-medium text-fg-muted">No messages yet</p>
                <p className="text-xs text-fg-faint mt-1 mb-4">Invite someone, then say hi.</p>
                <button
                  type="button"
                  onClick={() => void handleInvite()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-flow text-white text-sm font-medium rounded-xl btn-hover hover:shadow-[var(--glow)] hover:brightness-110 cursor-pointer transition-all duration-200"
                >
                  <UserPlus className="w-4 h-4" />
                  {inviteCopied ? 'Link copied' : 'Invite people'}
                </button>
                <p className="text-[11px] text-fg-faint mt-2">
                  Room code <span className="font-mono tracking-widest text-brand-text">{room.code}</span>
                </p>
              </div>
            )}
            </>
          )}

          {/* One-tap smart replies under the latest incoming message. */}
          {showReplyChip && (
            <div className="flex justify-start pl-1 -mt-1.5 animate-fade-in">
              <button
                type="button"
                onClick={() => void suggestReplies()}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-brand/5 border border-brand/20 text-brand-text rounded-full hover:bg-brand/10 cursor-pointer transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                Suggest replies
              </button>
            </div>
          )}

          {/* WhatsApp-style typing bubble with bouncing dots */}
          {typingOthers.length > 0 && (
            <div className="flex justify-start animate-fade-in">
              <div className="bg-surface-2 rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-2">
                <span className="text-xs text-fg-muted">
                  {typingOthers.map((p) => p.name).join(', ')}
                </span>
                <span className="flex items-end gap-0.5" aria-label="typing">
                  <span className="typing-dot w-1.5 h-1.5 bg-fg-faint rounded-full" />
                  <span className="typing-dot w-1.5 h-1.5 bg-fg-faint rounded-full" />
                  <span className="typing-dot w-1.5 h-1.5 bg-fg-faint rounded-full" />
                </span>
              </div>
            </div>
          )}
        </div>

        {/* "Catch me up" offer for people arriving in a busy room */}
        {catchUpOffer && aiTasks.has('summary') && summary === null && (
          <div className="relative">
            <div className="absolute -top-px left-1/2 -translate-x-1/2 z-10 flex items-center bg-surface border border-brand/30 rounded-full shadow-lg animate-fade-in-scale">
              <button
                type="button"
                onClick={() => void catchMeUp()}
                className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-xs font-medium text-brand-text cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Catch me up
              </button>
              <button
                type="button"
                onClick={() => setCatchUpOffer(false)}
                className="p-1.5 mr-1 rounded-full text-fg-faint hover:text-fg cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* WhatsApp-style jump-to-latest arrow, floats above the composer */}
        {(showJumpDown || unseenCount > 0) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setUnseenCount(0);
                scrollRef.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: 'smooth',
                });
              }}
              className={`absolute bottom-3 right-3 sm:right-4 z-10 flex items-center gap-1 rounded-full bg-surface border shadow-lg hover:bg-surface-2 cursor-pointer animate-fade-in-scale ${
                unseenCount > 0
                  ? 'pl-3 pr-2 py-2 border-brand/40 text-brand-text'
                  : 'p-2.5 border-edge text-fg-muted hover:text-fg'
              }`}
              title="Jump to latest messages"
              aria-label={unseenCount > 0 ? `${unseenCount} new messages, scroll to bottom` : 'Scroll to bottom'}
            >
              {unseenCount > 0 && (
                <span className="text-xs font-semibold tabular-nums">{unseenCount} new</span>
              )}
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={handleSend}
          className="border-t border-edge bg-surface px-2 sm:px-4 pt-2.5 sm:pt-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:pb-3 space-y-2"
        >
          {sendError && (
            <p className="text-xs text-danger-text px-1">{sendError}</p>
          )}

          {/* Reply preview (WhatsApp-style bar above the input) */}
          {replyTo && (
            <div className="flex items-start gap-2 p-2 bg-surface-2 border-l-4 border-brand rounded-lg animate-fade-in">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-brand-text">{replyTo.sender_name}</p>
                <p className="text-xs text-fg-muted truncate">
                  {getAtts(replyTo).length > 0
                    ? getAtts(replyTo)
                        .map((a) => a.name)
                        .join(', ')
                    : replyTo.content.slice(0, 120)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="p-1 text-fg-faint hover:text-fg cursor-pointer"
                aria-label="Cancel reply"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Attachment upload progress */}
          {uploadPercent !== null && (
            <div className="flex items-center gap-2 px-1">
              {uploadLabel && (
                <span className="text-[10px] text-fg-muted whitespace-nowrap">{uploadLabel}</span>
              )}
              <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                <div
                  className="relative h-full bg-flow rounded-full transition-all duration-200 overflow-hidden progress-shimmer"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
              <span className="text-[10px] text-fg-muted tabular-nums w-9 text-right">
                {uploadPercent}%
              </span>
            </div>
          )}

          {/* Emoji quick picker */}
          {showEmoji && (
            <div className="grid grid-cols-8 gap-0.5 p-2 border border-edge rounded-xl bg-surface-2 animate-fade-in-scale max-h-40 overflow-y-auto">
              {EMOJI_SET.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => insertEmoji(emoji)}
                  className="text-xl p-1 rounded-lg hover:bg-surface-3 cursor-pointer transition-colors"
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Pending attachment chips — uploaded files waiting to be sent */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 animate-fade-in">
              {pendingAttachments.map((att, i) => {
                const mime = att.mime_type || '';
                const Icon = mime.startsWith('image/')
                  ? ImageIcon
                  : mime.startsWith('video/')
                  ? Film
                  : mime.startsWith('audio/')
                  ? Music
                  : FileIcon;
                return (
                  <div
                    key={att.key}
                    className="flex items-center gap-1.5 bg-surface-2 border border-edge rounded-lg pl-2 pr-1 py-1 text-xs max-w-[200px] group"
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0 text-brand-text" />
                    <span className="truncate text-fg-muted">{att.name}</span>
                    <button
                      type="button"
                      onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))}
                      className="shrink-0 p-0.5 rounded text-fg-faint hover:text-fg hover:bg-surface-3 cursor-pointer transition-colors"
                      aria-label={`Remove ${att.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* AI panel: suggest replies + rewrite presets in one place */}
          {showAiPanel && (
            <div className="p-2 border border-edge rounded-xl bg-surface-2 animate-fade-in-scale space-y-1.5">
              {aiTasks.has('replies') && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAiPanel(false);
                    void suggestReplies();
                  }}
                  disabled={suggesting || messages.filter((m) => m.kind !== 'system').length === 0}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs bg-surface border border-edge text-fg-muted rounded-lg hover:bg-surface-3 hover:text-fg cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Sparkles className="w-3.5 h-3.5 text-brand-text" />
                  Suggest replies
                </button>
              )}
              {aiTasks.has('rewrite') && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-fg-faint px-1 flex items-center gap-1">
                    <Wand2 className="w-3 h-3" /> Rewrite:
                  </span>
                  {draft.trim() ? (
                    REWRITE_OPTIONS.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => applyRewrite(o.id)}
                        disabled={rewriting}
                        className="px-2.5 py-1 text-xs bg-surface border border-edge text-fg-muted rounded-full hover:bg-surface-3 hover:text-fg cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {o.label}
                      </button>
                    ))
                  ) : (
                    <span className="text-[10px] text-fg-faint">type a message first</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* AI smart-reply chips + rewrite undo */}
          {(suggestions.length > 0 || suggesting || rewriting || preRewriteDraft !== null) && (
            <div className="flex flex-wrap items-center gap-1.5 px-1 animate-fade-in">
              {rewriting && (
                <span className="flex items-center gap-1.5 text-xs text-fg-faint">
                  <Wand2 className="w-3 h-3 animate-pulse text-brand-text" />
                  Rewriting…
                  <button
                    type="button"
                    onClick={() => rewriteAbort.current?.abort()}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs text-fg-muted border border-edge rounded-full hover:bg-surface-2 hover:text-fg cursor-pointer"
                  >
                    <Square className="w-2.5 h-2.5" />
                    Stop
                  </button>
                </span>
              )}
              {suggesting && (
                <span className="flex items-center gap-1.5 text-xs text-fg-faint">
                  <Sparkles className="w-3 h-3 animate-pulse text-brand-text" />
                  Thinking…
                </span>
              )}
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setDraft(s);
                    setSuggestions([]);
                    textareaRef.current?.focus();
                  }}
                  className="px-3 py-1.5 text-xs bg-brand/5 border border-brand/25 text-brand-text rounded-full hover:bg-brand/10 cursor-pointer transition-colors"
                >
                  {s}
                </button>
              ))}
              {preRewriteDraft !== null && !rewriting && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(preRewriteDraft);
                    setPreRewriteDraft(null);
                    textareaRef.current?.focus();
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-fg-muted underline hover:text-fg cursor-pointer"
                  title="Restore your original message"
                >
                  <RotateCcw className="w-3 h-3" />
                  Undo rewrite
                </button>
              )}
            </div>
          )}

          <div className="flex items-end gap-1 sm:gap-2 min-w-0">
            {/* Mobile-only: while typing the tools collapse behind a "+"
                that opens a drop-up menu with the same options. */}
            {draft.length > 0 && (
              <div className="relative sm:hidden shrink-0 animate-fade-in">
                <button
                  type="button"
                  onClick={() => setShowToolsMenu((s) => !s)}
                  className={`h-10 w-9 flex items-center justify-center rounded-xl transition-colors cursor-pointer ${
                    showToolsMenu ? 'bg-brand/10 text-brand-text' : 'text-fg-muted hover:bg-surface-2'
                  }`}
                  title="More options"
                  aria-label="More options"
                  aria-expanded={showToolsMenu}
                >
                  <Plus
                    className={`w-5 h-5 transition-transform duration-200 ${
                      showToolsMenu ? 'rotate-45' : ''
                    }`}
                  />
                </button>
                {showToolsMenu && (
                  <>
                    {/* Tap-away backdrop so the menu closes on outside tap */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowToolsMenu(false)}
                      aria-hidden="true"
                    />
                    <div className="absolute bottom-full left-0 mb-2 z-20 min-w-[160px] p-1.5 flex flex-col gap-0.5 bg-surface border border-edge rounded-xl shadow-lg animate-menu-up">
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsMenu(false);
                          setShowEmoji(true);
                        }}
                        className="flex items-center gap-2.5 px-3 py-2 text-sm text-fg rounded-lg hover:bg-surface-2 cursor-pointer text-left transition-colors animate-menu-item"
                        style={{ animationDelay: '30ms' }}
                      >
                        <Smile className="w-4 h-4 text-fg-muted" />
                        Emoji
                      </button>
                      {(aiTasks.has('replies') || aiTasks.has('rewrite')) && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowToolsMenu(false);
                            setShowAiPanel(true);
                          }}
                          className="flex items-center gap-2.5 px-3 py-2 text-sm text-fg rounded-lg hover:bg-surface-2 cursor-pointer text-left transition-colors animate-menu-item"
                          style={{ animationDelay: '75ms' }}
                        >
                          <Sparkles className="w-4 h-4 text-brand-text" />
                          AI assistant
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsMenu(false);
                          fileInputRef.current?.click();
                        }}
                        disabled={uploadPercent !== null}
                        className="flex items-center gap-2.5 px-3 py-2 text-sm text-fg rounded-lg hover:bg-surface-2 cursor-pointer text-left transition-colors animate-menu-item disabled:opacity-50"
                        style={{ animationDelay: '120ms' }}
                      >
                        <Paperclip className="w-4 h-4 text-fg-muted" />
                        Attach files
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <div
              className={`grid shrink-0 transition-[grid-template-columns] duration-300 ease-out sm:grid-cols-[1fr] ${
                draft.length > 0 ? 'grid-cols-[0fr]' : 'grid-cols-[1fr]'
              }`}
            >
              <div className="flex items-end gap-1 sm:gap-2 overflow-hidden min-w-0">
                <button
                  type="button"
                  onClick={() => setShowEmoji((s) => !s)}
                  disabled={timeRemaining === 'expired'}
                  className={`shrink-0 h-10 w-10 sm:h-11 sm:w-11 flex items-center justify-center rounded-xl transition-colors ${
                    showEmoji ? 'bg-brand/10 text-brand-text' : 'text-fg-muted hover:bg-surface-2'
                  } ${timeRemaining === 'expired' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  title="Emoji"
                  aria-label="Open emoji picker"
                >
                  <Smile className="w-5 h-5" />
                </button>
                {(aiTasks.has('replies') || aiTasks.has('rewrite')) && (
                  <button
                    type="button"
                    onClick={() => setShowAiPanel((s) => !s)}
                    disabled={timeRemaining === 'expired'}
                    className={`shrink-0 h-10 w-10 sm:h-11 sm:w-11 flex items-center justify-center rounded-xl transition-colors ${
                      showAiPanel || suggesting || rewriting
                        ? 'bg-brand/10 text-brand-text'
                        : 'text-fg-muted hover:bg-surface-2'
                    } disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}
                    title="AI assistant"
                    aria-label="Open AI assistant"
                  >
                    <Sparkles className={`w-5 h-5 ${suggesting || rewriting ? 'animate-pulse' : ''}`} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadPercent !== null || timeRemaining === 'expired'}
                  className={`shrink-0 h-10 w-10 sm:h-11 sm:w-11 flex items-center justify-center rounded-xl text-fg-muted hover:bg-surface-2 transition-colors ${
                    uploadPercent !== null || timeRemaining === 'expired'
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer'
                  }`}
                  title="Attach photo, video, or file"
                  aria-label="Attach photo, video, or file"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFilePicked}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
            <TextareaAutosize
              ref={textareaRef}
              value={draft}
              onChange={handleDraftChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Message"
              title={
                isTouch ? undefined : 'Enter to send · Shift+Enter for a new line'
              }
              minRows={1}
              maxRows={6}
              className="input-base no-scrollbar flex-1 min-w-0 px-3 py-2 sm:py-2.5 text-base sm:text-sm leading-snug resize-none"
              // Not disabled while sending: a disabled field loses focus and
              // the phone keyboard closes after every message.
              disabled={timeRemaining === 'expired'}
            />
            <button
              type="submit"
              // Don't steal focus from the textarea (keeps the keyboard up).
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              disabled={sending || uploadPercent !== null || (!draft.trim() && pendingAttachments.length === 0) || timeRemaining === 'expired'}
              className={`shrink-0 h-10 w-10 sm:h-11 sm:w-11 flex items-center justify-center rounded-xl text-white transition-all duration-200 ${
                sending || uploadPercent !== null || (!draft.trim() && pendingAttachments.length === 0) || timeRemaining === 'expired'
                  ? 'bg-surface-3 text-fg-faint cursor-not-allowed'
                  : 'bg-flow hover:brightness-110 hover:shadow-[var(--glow)] cursor-pointer'
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
          <p className="text-[10px] text-fg-faint px-1">
            Sending as <span className="font-medium text-fg-muted">{displayName}</span>
            {!user && ' (guest)'}
            <span className="mx-1">&middot;</span>
            <button
              type="button"
              onClick={() => setAskingName(true)}
              className="underline hover:text-fg-muted cursor-pointer"
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
        <div className="fixed inset-x-0 bottom-0 bg-danger/10 backdrop-blur-md border-t border-danger/20 px-4 py-2 text-center text-sm text-danger-text">
          This room has expired. <Link href="/chat" className="underline">Create a new one</Link>
        </div>
      )}
    </div>
  );
}

