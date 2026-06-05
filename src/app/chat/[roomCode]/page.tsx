import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
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
        <div className="text-5xl mb-4">⏰</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Room expired</h1>
        <p className="text-sm text-gray-600 mb-6">
          This chat room has expired and is no longer accessible.
        </p>
        <Link
          href="/chat"
          className="inline-block px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          Create a new room
        </Link>
      </div>
    );
  }

  const joinUrl = `${getRequestOrigin(await headers())}/chat/${room.code}`;
  return <ChatRoom room={room} joinUrl={joinUrl} />;
}
