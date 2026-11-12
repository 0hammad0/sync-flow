import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Phone → PC',
  description:
    'Send files from your phone to this computer: scan a QR code, pick up to 25 files, and download them here. No app, no cable. Sessions last 10 minutes.',
  alternates: { canonical: '/receive' },
};

export default function ReceiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
