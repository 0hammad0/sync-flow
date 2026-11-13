'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Sheet from '@/shared/ui/Sheet';

/**
 * The detail drawer over the files table (intercepted route). Closing goes
 * back, so the table, its filters and its scroll stay as they were.
 */
export default function FileDrawer({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(open) => !open && router.back()} side="right" width="min(440px, 100vw)" title={title}>
      {children}
    </Sheet>
  );
}
