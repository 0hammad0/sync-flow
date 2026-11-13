'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clock, X } from 'lucide-react';
import Button from '@/shared/ui/Button';
import RoomLinkPending from '@/features/chat/components/RoomLinkPending';
import { clientTimezone, formatTimeUntil } from '@/shared/lib/time';
import { isValidRoomCode, ROOM_CODE_LENGTH } from '@/shared/lib/utils';
import {
  RECENT_ROOMS_KEY,
  forgetRoom,
  friendlyError,
  parseRecent,
  readStorage,
} from '@/features/chat/lib/chat-helpers';

const TTL_OPTIONS: ReadonlyArray<{ value: 1 | 24 | 168; label: string }> = [
  { value: 1, label: '1 hour' },
  { value: 24, label: '24 hours' },
  { value: 168, label: '7 days' },
];

// Recent rooms live in localStorage; this keeps other tabs' visits in sync
// and renders nothing on the server (no hydration mismatch).
function subscribeStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}
const readRecentRaw = () => readStorage(RECENT_ROOMS_KEY) ?? '';
const noRecentOnServer = () => '';

export default function ChatLobby() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [ttl, setTtl] = useState<1 | 24 | 168>(24);
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  // Bumped after "forget" — same-tab writes don't fire the storage event.
  const [, setRecentVersion] = useState(0);

  const recentRaw = useSyncExternalStore(subscribeStorage, readRecentRaw, noRecentOnServer);
  const recentRooms = useMemo(
    () => parseRecent(recentRaw).filter((r) => new Date(r.expires_at).getTime() > now),
    [recentRaw, now]
  );

  // Name is optional; expiry defaults to 24h.
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    // No double submits. `creating` is never reset on success, so the button
    // keeps its spinner until the room page (or its skeleton) replaces this one.
    if (creating || joining) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          ttlHours: ttl,
          tz: clientTimezone(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(friendlyError(data.error || 'Couldn\'t create the room. Please try again.', res.status));
      }
      router.push(`/chat/${data.code}`);
    } catch (err) {
      setError(friendlyError(err));
      setCreating(false);
    }
  };

  // Straight to the room page — it already shows "not found" / "expired",
  // so checking here first would just read the room twice.
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (joining || creating) return;
    const code = joinCode.trim().toUpperCase();
    if (!isValidRoomCode(code)) {
      setError(`Code must be ${ROOM_CODE_LENGTH} letters/digits (no I, O, 0, 1, L).`);
      return;
    }
    setJoining(true);
    setError(null);
    router.push(`/chat/${code}`);
  };

  return (
    <div className="max-w-xl mx-auto py-8 sm:py-12 animate-fade-in">
      <div className="text-center mb-8">
        <p className="label-mono mb-3">Ephemeral by design</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-fg mb-2">Chat rooms</h1>
        <p className="text-sm text-fg-muted">
          Start a temporary room and share the link with anyone to start chatting.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-2xl animate-fade-in">
          <p className="text-xs sm:text-sm text-danger-text">{error}</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Create */}
        <form
          onSubmit={handleCreate}
          className="bg-surface border border-edge rounded-3xl p-5 sm:p-6 card-hover"
        >
          <h2 className="font-display text-base sm:text-lg font-semibold tracking-tight text-fg mb-1">Start a room</h2>
          <p className="text-xs text-fg-muted mb-4">
            You&apos;ll get a link to share. Lasts {TTL_OPTIONS.find((o) => o.value === ttl)?.label}.
          </p>

          <label htmlFor="room-name" className="block text-xs font-medium text-fg mb-1.5">
            Room name <span className="text-fg-faint font-normal">(optional)</span>
          </label>
          <input
            id="room-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. project standup"
            className="input-base w-full mb-3 px-3 py-2 text-base pointer-fine:sm:text-sm"
          />

          <label htmlFor="room-ttl" className="block text-xs font-medium text-fg mb-1.5">
            Room expires after
          </label>
          <select
            id="room-ttl"
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value) as 1 | 24 | 168)}
            className="input-base w-full mb-4 px-3 py-2 text-sm cursor-pointer"
          >
            {TTL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <Button
            type="submit"
            variant="primary"
            size="md"
            fullWidth
            disabled={creating}
            loading={creating}
            loadingText="Starting…"
          >
            Start a room
          </Button>
        </form>

        {/* Join */}
        <form
          onSubmit={handleJoin}
          className="bg-surface border border-edge rounded-3xl p-5 sm:p-6 card-hover"
        >
          <h2 className="font-display text-base sm:text-lg font-semibold tracking-tight text-fg mb-1">Join a room</h2>
          <p className="text-xs text-fg-muted mb-4">
            Enter the code someone shared with you.
          </p>

          <label className="block text-xs font-medium text-fg mb-1.5">
            Room code ({ROOM_CODE_LENGTH} characters)
          </label>
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="ABC23XYZ"
            autoComplete="off"
            spellCheck={false}
            className="input-base w-full mb-4 px-3 py-2 text-base pointer-fine:sm:text-sm font-mono uppercase tracking-widest"
          />

          <Button
            type="submit"
            variant="dark"
            size="md"
            fullWidth
            disabled={joining || joinCode.length !== ROOM_CODE_LENGTH}
            loading={joining}
            loadingText="Joining…"
          >
            Join room
          </Button>
        </form>
      </div>

      {/* Rooms visited on this device — guests and joiners have no dashboard list. */}
      {recentRooms.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-fg mb-2">Recent rooms</h2>
          <ul className="space-y-2">
            {recentRooms.map((r) => (
              <li
                key={r.code}
                // The text dims while this card's navigation is pending
                // (RoomLinkPending renders the data attribute only then). Not
                // the li itself: animate-fade-in's `forwards` fill pins its opacity.
                className="flex items-center gap-2 p-1 pl-3 bg-surface border border-edge rounded-2xl card-hover animate-fade-in group/room"
              >
                <Link
                  href={`/chat/${r.code}`}
                  className="min-w-0 flex-1 py-2 cursor-pointer flex items-center gap-2"
                >
                  <div className="min-w-0 flex-1 transition-opacity group-has-[[data-room-link-pending]]/room:opacity-60">
                    <p className="text-sm font-medium text-fg truncate">{r.name || 'Untitled room'}</p>
                    <p className="text-xs text-fg-muted mt-0.5 flex items-center gap-1.5">
                      <span className="font-mono tracking-widest text-brand-text">{r.code}</span>
                      <span>&middot;</span>
                      <Clock className="w-3 h-3" />
                      <span title={new Date(r.expires_at).toLocaleString()}>
                        {formatTimeUntil(r.expires_at)} left
                      </span>
                    </p>
                  </div>
                  <RoomLinkPending />
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    forgetRoom(r.code);
                    setRecentVersion((v) => v + 1);
                  }}
                  className="shrink-0 p-2 rounded-lg text-fg-faint hover:text-fg hover:bg-surface-2 cursor-pointer"
                  title="Remove from this list"
                  aria-label={`Remove ${r.name || r.code} from recent rooms`}
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-xs text-fg-faint text-center">
        Rooms auto-delete when they expire. Signed-in users see rooms they created on the dashboard.
      </p>
    </div>
  );
}
