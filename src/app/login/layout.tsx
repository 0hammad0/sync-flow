import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to SyncFlow with a one-time email link. No password needed.',
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
