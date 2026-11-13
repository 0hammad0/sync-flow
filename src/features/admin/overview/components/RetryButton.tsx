'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import AdminButton from '@/shared/ui/AdminButton';

/** Re-runs the page's server queries. Failures are never cached, so the failed widget reads again. */
export default function RetryButton({ label = 'Retry' }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <AdminButton size="sm" icon={RotateCw} loading={pending} onClick={() => startTransition(() => router.refresh())}>
      {label}
    </AdminButton>
  );
}
