'use client';

import { useSyncExternalStore } from 'react';
import { IDLE_AFTER_MS } from '../poll';
import { createIdleStore, type IdleStore } from '../idle';

// Browser state the polls depend on, as external stores. Server render and
// hydration assume visible, online and active, so nothing flashes.

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  );
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

let idleStore: IdleStore | undefined;

/** One idle watcher per page (created on first use in the browser). */
export function getIdleStore(): IdleStore {
  idleStore ??= createIdleStore({ timeoutMs: IDLE_AFTER_MS, target: window });
  return idleStore;
}

const subscribeIdle = (onChange: () => void) => getIdleStore().subscribe(onChange);
const idleSnapshot = () => getIdleStore().getSnapshot();
const serverIdle = () => false;

/** `[idle, resume]`. Shared by every poll on the page. */
export function useIdle(): [boolean, () => void] {
  const idle = useSyncExternalStore(subscribeIdle, idleSnapshot, serverIdle);
  return [idle, resumeIdle];
}

function resumeIdle() {
  getIdleStore().resume();
}

/** True at ≥ `query` (e.g. `(min-width: 64rem)`). Server and first paint: `fallback`. */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia?.(query);
      mq?.addEventListener('change', onChange);
      return () => mq?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? fallback,
    () => fallback,
  );
}
