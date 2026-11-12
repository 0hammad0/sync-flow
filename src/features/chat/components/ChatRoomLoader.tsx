'use client';

import dynamic from 'next/dynamic';
import ChatRoomSkeleton from '@/features/chat/components/ChatRoomSkeleton';
import type { ChatRoom as ChatRoomType } from '@/types';

// The room renders client-only: its first frame depends on localStorage (saved
// display name, sound/notification prefs), so server-rendering it would flash
// the name form for returning users or mismatch on hydration.
const ChatRoom = dynamic(() => import('@/features/chat/components/ChatRoom'), {
  ssr: false,
  // Same skeleton as the route's loading.tsx, so the hand-off from "page
  // loading" to "room code loading" doesn't flash a different placeholder.
  loading: () => <ChatRoomSkeleton />,
});

export default function ChatRoomLoader(props: { room: ChatRoomType; joinUrl: string }) {
  return <ChatRoom {...props} />;
}
