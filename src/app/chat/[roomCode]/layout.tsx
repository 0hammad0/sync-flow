import type { Metadata } from 'next';

// Chat rooms are private and temporary: never index them.
export const metadata: Metadata = {
  title: 'Chat room',
  robots: { index: false, follow: false },
};

export default function ChatRoomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
