'use client';

import dynamic from 'next/dynamic';
import LoadingSpinner from '@/shared/components/LoadingSpinner';
import type { ChatRoom as ChatRoomType } from '@/types';

// The room renders client-only: its first frame depends on localStorage (saved
// display name, sound/notification prefs), so server-rendering it would flash
// the name form for returning users or mismatch on hydration.
const ChatRoom = dynamic(() => import('@/features/chat/components/ChatRoom'), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center py-16">
      <LoadingSpinner size="md" className="text-fg-faint" />
    </div>
  ),
});

export default function ChatRoomLoader(props: { room: ChatRoomType; joinUrl: string }) {
  return <ChatRoom {...props} />;
}
