'use client';

import {
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
import { onAuthStateChanged, type User } from 'firebase/auth';
import TextareaAutosize from 'react-textarea-autosize';
import {
  ChevronDown,
  File as FileIcon,
  Film,
  Image as ImageIcon,
  MessageCircle,
  Music,
  Paperclip,
  Plus,
  QrCode,
  RotateCcw,
  Send,
  Smile,
  Sparkles,
  UploadCloud,
  Wand2,
  X,
} from 'lucide-react';
import { clientAuth, clientDb } from '@/shared/lib/firebase/client';
import { clientTimezone, formatTimeUntil } from '@/shared/lib/time';
import {
  cleanAiOutput,
  getAiAvailability,
  streamAi,
  stripInlineMarkdown,
} from '@/features/ai/lib/ai-client';
import {
  formatFileSize,
  INLINE_TEXT_BYTES,
  LONG_TEXT_PREVIEW_CHARS,
  MAX_LONG_TEXT_BYTES,
} from '@/shared/lib/utils';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import CopyButton from '@/shared/components/CopyButton';
import QRModal from '@/features/files/components/QRModal';
import { MediaViewer } from '@/features/chat/components/MediaViewer';
import { MessageBubble, SystemNotice } from '@/features/chat/components/MessageBubble';
import {
  EMOJI_SET,
  HEARTBEAT_MS,
  MAX_ALBUM_FILES,
  MAX_ATTACHMENT_BYTES,
  MESSAGES_WINDOW,
  ONLINE_WINDOW_MS,
  REWRITE_OPTIONS,
  STORED_NAME_KEY,
  TYPING_THROTTLE_MS,
  byteLen,
  getAtts,
  getDeviceId,
  nameForUser,
  previewKind,
  toggleReactionLocal,
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
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [deviceId] = useState(() => (typeof window === 'undefined' ? '' : getDeviceId()));
  const [now, setNow] = useState(() => Date.now());
  const [presence, setPresence] = useState<ChatPresence[]>([]);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const [dragOver, setDragOver] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  // AI features (OpenRouter via /api/ai) — aiTasks holds what the server
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

  // Jump straight to the newest messages when the room first loads.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (loadingMessages || didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    didInitialScroll.current = true;
  }, [loadingMessages, messages]);

  // Auto-scroll to bottom only when a NEW message is appended (and the user is
  // already near the bottom). In-place updates like reactions must NOT scroll,
  // otherwise reacting to a message jumps the view to the bottom.
  const scrollMetaRef = useRef({ len: 0, lastId: '' });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const lastId = messages.length ? messages[messages.length - 1].id : '';
    const prev = scrollMetaRef.current;
    const appended = messages.length > prev.len || (lastId !== '' && lastId !== prev.lastId);
    scrollMetaRef.current = { len: messages.length, lastId };
    if (!appended) return; // reaction / edit — leave the scroll position alone
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Periodic tick for "expires in" countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
        // Spell out the actual size — phone videos routinely exceed the cap
        // and a vague message reads like "upload is broken".
        setSendError(
          `"${file.name}" is ${formatFileSize(file.size)} — the limit is 100 MB. ` +
            'Try a shorter clip or a lower resolution.'
        );
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

  // Upload one file body (no message yet) with progress — albums upload
  // each file separately so per-request limits never apply to the batch.
  const xhrUploadOnly = useCallback(
    (file: File, onProgress: (loaded: number) => void) =>
      new Promise<ChatAttachment>((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('originalName', file.name);
        formData.append('senderName', displayName);
        formData.append('caption', '');
        formData.append('tz', clientTimezone());
        formData.append('deviceId', deviceId);
        formData.append('uploadOnly', '1');

        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onProgress(e.loaded);
        });
        xhr.addEventListener('load', () => {
          try {
            const res = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && res.success && res.attachment) {
              resolve(res.attachment as ChatAttachment);
            } else {
              reject(new Error(res.error || `HTTP ${xhr.status}`));
            }
          } catch {
            reject(new Error('invalid server response'));
          }
        });
        xhr.addEventListener('error', () => reject(new Error('network error')));
        xhr.addEventListener('abort', () => reject(new Error('aborted')));
        xhr.open('POST', `/api/chat/${room.code}/attachments`);
        xhr.send(formData);
      }),
    [displayName, deviceId, room.code]
  );

  // Upload files to R2 without sending — stores them as pending attachments
  // so the user can add a caption and send explicitly.
  const uploadFilesAsPending = useCallback(
    async (files: File[]) => {
      const rejected = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES || f.size === 0);
      const valid = files
        .filter((f) => f.size > 0 && f.size <= MAX_ATTACHMENT_BYTES)
        .slice(0, MAX_ALBUM_FILES);
      if (rejected.length > 0) {
        setSendError(
          rejected
            .map((f) =>
              f.size === 0
                ? `"${f.name}" is empty — skipped.`
                : `"${f.name}" is ${formatFileSize(f.size)} — over 100 MB, skipped.`
            )
            .join(' ')
        );
      } else {
        setSendError(null);
      }
      if (valid.length === 0) return;
      const totalBytes = valid.reduce((s, f) => s + f.size, 0);
      let doneBytes = 0;
      setUploadPercent(0);
      setUploadLabel(valid.length > 1 ? `Uploading 1/${valid.length}` : 'Uploading');
      try {
        const metas: ChatAttachment[] = [];
        for (let i = 0; i < valid.length; i++) {
          setUploadLabel(valid.length > 1 ? `Uploading ${i + 1}/${valid.length}` : 'Uploading');
          const meta = await xhrUploadOnly(valid[i], (loaded) => {
            setUploadPercent(Math.round(((doneBytes + loaded) / totalBytes) * 100));
          });
          doneBytes += valid[i].size;
          setUploadPercent(Math.round((doneBytes / totalBytes) * 100));
          metas.push(meta);
        }
        setPendingAttachments((prev) => [...prev, ...metas].slice(0, MAX_ALBUM_FILES));
        textareaRef.current?.focus();
      } catch (err) {
        setSendError(
          `Upload failed: ${err instanceof Error ? err.message : 'unknown error'}. Please try again.`
        );
      } finally {
        setUploadPercent(null);
        setUploadLabel(null);
      }
    },
    [xhrUploadOnly]
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
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
          setDraft('');
          setPendingAttachments([]);
          setShowEmoji(false);
          setReplyTo(null);
          lastTypingBeat.current = 0;
          sendHeartbeat(false);
        } catch (err) {
          setSendError(err instanceof Error ? err.message : 'Failed to send');
        } finally {
          setSending(false);
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
    [draft, pendingAttachments, uploadPercent, displayName, room.code, sending, replyTo, deviceId, sendHeartbeat, uploadAttachment]
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
      if (parsed.length === 0) setSendError('No suggestions this time — try again.');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'AI request failed');
    }
    setSuggesting(false);
  }, [suggesting, buildTranscript, displayName]);

  // "Catch me up": streamed room summary shown in a dismissible panel.
  const catchMeUp = useCallback(async () => {
    if (summarizing) return;
    setSummarizing(true);
    setSummary('');
    setSummaryExpanded(false);
    try {
      await streamAi({ task: 'summary', transcript: buildTranscript(80) }, (t) => setSummary(t));
    } catch (err) {
      setSummary(
        `⚠ ${err instanceof Error ? err.message : 'AI request failed'}`
      );
    }
    setSummarizing(false);
  }, [summarizing, buildTranscript]);

  // Rewrite the draft in place, streaming into the textarea; undoable.
  const applyRewrite = useCallback(
    async (instruction: string) => {
      const original = draft;
      if (!original.trim() || rewriting) return;
      setShowAiPanel(false);
      setRewriting(true);
      setPreRewriteDraft(original);
      setSendError(null);
      setDraft('');
      try {
        const result = await streamAi(
          { task: 'rewrite', text: original, instruction },
          (t) => setDraft(t)
        );
        const cleaned = cleanAiOutput(result);
        // An empty or refused rewrite should never eat the draft.
        setDraft(cleaned || original);
        if (!cleaned) setPreRewriteDraft(null);
      } catch (err) {
        setDraft(original);
        setPreRewriteDraft(null);
        setSendError(err instanceof Error ? err.message : 'AI request failed');
      }
      setRewriting(false);
      textareaRef.current?.focus();
    },
    [draft, rewriting]
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
      const reactor = { id: deviceId, name: displayName };
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

  if (askingName) {
    return (
      <div className="max-w-sm mx-auto px-4 py-12 animate-fade-in">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">Pick a display name</h1>
        <p className="text-sm text-fg-muted mb-4">
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
            Enter Room
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
              {room.name || 'Chat Room'}
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
                title={`Expires ${new Date(room.expires_at).toLocaleString()}`}
              >
                {timeRemaining === 'expired' ? (
                  <span className="text-danger-text font-medium">expired</span>
                ) : (
                  <span className="text-fg-muted">expires in {timeRemaining}</span>
                )}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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
            <CopyButton text={joinUrl} compact />
            <button
              onClick={() => setShowQR(true)}
              className="p-2 bg-surface border border-edge text-fg-muted rounded-lg hover:bg-surface-3 hover:text-fg cursor-pointer transition-colors"
              title="Show QR code for joining"
              aria-label="Show QR code for joining"
            >
              <QrCode className="w-4 h-4" />
            </button>
          </div>
        </div>

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
              {summarizing && <span className="font-normal normal-case tracking-normal text-fg-faint">thinking…</span>}
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
            setShowJumpDown(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
          }}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-2 sm:px-4 py-3 sm:py-4 space-y-3 bg-canvas/50"
          aria-live="polite"
        >
          {loadingMessages ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner size="md" className="text-fg-faint" />
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <MessageCircle className="w-10 h-10 mb-3 text-fg-faint/50" />
              <p className="text-sm font-medium text-fg-muted">No messages yet</p>
              <p className="text-xs text-fg-faint mt-1">
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

        {/* WhatsApp-style jump-to-latest arrow, floats above the composer */}
        {showJumpDown && (
          <div className="relative">
            <button
              type="button"
              onClick={() =>
                scrollRef.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: 'smooth',
                })
              }
              className="absolute bottom-3 right-3 sm:right-4 z-10 p-2.5 rounded-full bg-surface border border-edge shadow-lg text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer animate-fade-in-scale"
              title="Jump to latest messages"
              aria-label="Scroll to bottom"
            >
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
                        key={o.label}
                        type="button"
                        onClick={() => applyRewrite(o.instruction)}
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
          {(suggestions.length > 0 || suggesting || preRewriteDraft !== null) && (
            <div className="flex flex-wrap items-center gap-1.5 px-1 animate-fade-in">
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
              placeholder="Message"
              title={
                isTouch ? undefined : 'Enter to send · Shift+Enter for a new line'
              }
              minRows={1}
              maxRows={6}
              className="input-base no-scrollbar flex-1 min-w-0 px-3 py-2 sm:py-2.5 text-base sm:text-sm leading-snug resize-none"
              disabled={sending || timeRemaining === 'expired'}
            />
            <button
              type="submit"
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

