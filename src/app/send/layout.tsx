import type { Metadata } from 'next';

// Phone upload pages are per-session and short-lived: never index them.
export const metadata: Metadata = {
  title: 'Send to your PC',
  robots: { index: false, follow: false },
};

export default function SendLayout({ children }: { children: React.ReactNode }) {
  return children;
}
