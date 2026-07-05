import ChatLobby from '@/features/chat/components/ChatLobby';

export const metadata = {
  title: 'Chat Rooms',
  description: 'Create or join a temporary chat room with a secure code.',
};

export default function ChatPage() {
  return <ChatLobby />;
}
