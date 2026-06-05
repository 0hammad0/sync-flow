'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingSpinner from './LoadingSpinner';
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
    <div className="max-w-xl mx-auto px-4 py-8 sm:py-12 animate-fade-in">
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Chat Rooms</h1>
        <p className="text-sm text-gray-600">
          Create a temporary room and share the code with anyone to start chatting.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs sm:text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Create */}
        <form
          onSubmit={handleCreate}
          className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 card-hover"
        >
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Create a room</h2>
          <p className="text-xs text-gray-500 mb-4">
            You&apos;ll get a short code to share with participants.
          </p>

          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Room name <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. project standup"
            className="w-full mb-4 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Room expires after
          </label>
          <select
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value) as 1 | 24 | 168)}
            className="w-full mb-4 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {TTL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <button
            type="submit"
            disabled={creating}
            className={`w-full py-2.5 rounded-lg text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              creating
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 cursor-pointer btn-hover'
            }`}
          >
            {creating ? (
              <>
                <LoadingSpinner size="sm" className="text-white" />
                <span>Creating&hellip;</span>
              </>
            ) : (
              'Create Room'
            )}
          </button>
        </form>

        {/* Join */}
        <form
          onSubmit={handleJoin}
          className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 card-hover"
        >
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Join a room</h2>
          <p className="text-xs text-gray-500 mb-4">
            Enter the code someone shared with you.
          </p>

          <label className="block text-xs font-medium text-gray-700 mb-1.5">
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
            className="w-full mb-4 px-3 py-2 text-sm font-mono uppercase tracking-widest border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <button
            type="submit"
            disabled={joining || joinCode.length !== ROOM_CODE_LENGTH}
            className={`w-full py-2.5 rounded-lg text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              joining || joinCode.length !== ROOM_CODE_LENGTH
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gray-900 hover:bg-gray-800 cursor-pointer btn-hover'
            }`}
          >
            {joining ? (
              <>
                <LoadingSpinner size="sm" className="text-white" />
                <span>Joining&hellip;</span>
              </>
            ) : (
              'Join Room'
            )}
          </button>
        </form>
      </div>

      <p className="mt-8 text-xs text-gray-400 text-center">
        Rooms auto-delete when they expire. Logged-in users can see their created rooms on the dashboard.
      </p>
    </div>
  );
}
