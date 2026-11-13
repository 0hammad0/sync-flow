'use client';

import dynamic from 'next/dynamic';

// sonner loads after the shell, in its own chunk: toasts only follow a user
// action, so nothing needs it on first paint. Callers import `toast` from
// sonner lazily too (see AccountMenu), or sonner would be first-load again.
const LazyToaster = dynamic(() => import('@/shared/ui/Toaster'), { ssr: false });

export default LazyToaster;
