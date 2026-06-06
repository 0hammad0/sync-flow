'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from './ui/Button';
import { clientTimezone } from '@/lib/time';
import { isValidRoomCode, ROOM_CODE_LENGTH } from '@/lib/utils';

const TTL_OPTIONS: ReadonlyArray<{ value: 1 | 24 | 168; label: string }> = [
  { value: 1, label: '1 hour' },
  { value: 24, label: '24 hours' },
  { value: 168, label: '7 days' },
];

export default function ChatLobby() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [ttl, setTtl] = useState<1 | 24 | 168>(24);
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create room');
      }
      router.push(`/chat/${data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
      setCreating(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!isValidRoomCode(code)) {
      setError(`Code must be ${ROOM_CODE_LENGTH} letters/digits (no I, O, 0, 1, L).`);
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/${code}`);
      const data = await res.json();
      if (res.status === 404) throw new Error('No room with that code.');
      if (res.status === 410) throw new Error('That room has expired.');
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to join');
      router.push(`/chat/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
      setJoining(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-8 sm:py-12 animate-fade-in">
      <div className="text-center mb-8">
        <p className="label-mono mb-3">Ephemeral by design</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-fg mb-2">Chat Rooms</h1>
        <p className="text-sm text-fg-muted">
          Create a temporary room and share the code with anyone to start chatting.
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
          <h2 className="font-display text-base sm:text-lg font-semibold tracking-tight text-fg mb-1">Create a room</h2>
          <p className="text-xs text-fg-muted mb-4">
            You&apos;ll get a short code to share with participants.
          </p>

          <label className="block text-xs font-medium text-fg mb-1.5">
            Room name <span className="text-fg-faint font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. project standup"
            className="input-base w-full mb-4 px-3 py-2 text-base sm:text-sm"
          />

          <label className="block text-xs font-medium text-fg mb-1.5">
            Room expires after
          </label>
          <select
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
            loadingText="Creating…"
          >
            Create Room
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
            className="input-base w-full mb-4 px-3 py-2 text-base sm:text-sm font-mono uppercase tracking-widest"
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
            Join Room
          </Button>
        </form>
      </div>

      <p className="mt-8 text-xs text-fg-faint text-center">
        Rooms auto-delete when they expire. Logged-in users can see their created rooms on the dashboard.
      </p>
    </div>
  );
}
