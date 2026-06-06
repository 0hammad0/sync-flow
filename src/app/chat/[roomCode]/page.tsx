import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import ChatRoom from '@/components/ChatRoom';
import { getRoom, isRoomExpired } from '@/lib/firebase/chat';
import { getRequestOrigin, isValidRoomCode } from '@/lib/utils';

interface ChatRoomPageProps {
  params: Promise<{ roomCode: string }>;
}

export const dynamic = 'force-dynamic';

export default async function ChatRoomPage({ params }: ChatRoomPageProps) {
  const { roomCode } = await params;
  const code = (roomCode || '').toUpperCase();

  if (!isValidRoomCode(code)) notFound();

  const room = await getRoom(code);
  if (!room) notFound();

  if (isRoomExpired(room)) {
    return (
      <div className="max-w-md mx-auto py-12 px-4 text-center animate-fade-in">
        <span className="inline-flex w-16 h-16 mb-4 rounded-3xl bg-surface-2 border border-edge text-fg-faint items-center justify-center">
          <Clock className="w-8 h-8" />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg mb-2">Room expired</h1>
        <p className="text-sm text-fg-muted mb-6">
          This chat room has expired and is no longer accessible.
        </p>
        <Link
          href="/chat"
          className="inline-block px-5 py-2.5 bg-flow text-white text-sm font-medium rounded-xl btn-hover hover:shadow-[var(--glow)] hover:brightness-110 transition-all duration-200"
        >
          Create a new room
        </Link>
      </div>
    );
  }

  const joinUrl = `${getRequestOrigin(await headers())}/chat/${room.code}`;
  return <ChatRoom room={room} joinUrl={joinUrl} />;
}
