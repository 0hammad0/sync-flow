'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import AdminButton from '@/shared/ui/AdminButton';

/** Re-runs the page's server queries (failures are never cached, so this really retries). */
export default function RetryButton({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <AdminButton size={size} icon={RotateCcw} loading={pending} onClick={() => startTransition(() => router.refresh())}>
      Retry
    </AdminButton>
  );
}
