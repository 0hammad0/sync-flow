'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

const BACK_ONLINE_MS = 2000;

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export interface OfflineBannerProps {
  /** Runs once when the connection comes back, e.g. `router.refresh()` to refetch visible views. */
  onReconnect?: () => void;
  /** Spacing / position only. Default: sticky under the admin top bar. */
  className?: string;
}

/**
 * "You're offline" bar (06-states.md 6.9). The `role="status"` region is always in the DOM
 * so screen readers announce the change; it has no height while online.
 */
export default function OfflineBanner({
  onReconnect,
  className = 'sticky top-[var(--admin-topbar-h,3.5rem)] z-20',
}: OfflineBannerProps) {
  // Server render and hydration assume online, so nothing flashes for online users.
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [backOnline, setBackOnline] = useState(false);
  const reconnect = useRef(onReconnect);
  useEffect(() => {
    reconnect.current = onReconnect;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handleOnline = () => {
      setBackOnline(true);
      clearTimeout(timer);
      timer = setTimeout(() => setBackOnline(false), BACK_ONLINE_MS);
      reconnect.current?.();
    };
    const handleOffline = () => {
      clearTimeout(timer);
      setBackOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const show = !online || backOnline;
  return (
    <div role="status" className={className}>
      {show && (
        <div className="flex min-h-8 items-center gap-2 border-b border-edge bg-surface-2 px-4 py-1 text-[13px] text-fg">
          {online ? (
            <>
              <Wifi className="size-4 shrink-0 text-success-text" aria-hidden="true" />
              Back online.
            </>
          ) : (
            <>
              <WifiOff className="size-4 shrink-0 text-warning-text" aria-hidden="true" />
              You&apos;re offline. Showing the last loaded data. Changes are paused.
            </>
          )}
        </div>
      )}
    </div>
  );
}
