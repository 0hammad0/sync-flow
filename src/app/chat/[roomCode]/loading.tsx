import ChatRoomSkeleton from '@/features/chat/components/ChatRoomSkeleton';

// The room page is force-dynamic and reads Firestore on the server before it
// can render. Without this boundary a client navigation from /chat (or the
// dashboard) keeps the old page on screen until that read finishes, so a click
// looks like it did nothing. This shows the room's shape instantly instead.
export default function ChatRoomLoading() {
  return <ChatRoomSkeleton />;
}
