'use client';

import { useSyncExternalStore } from 'react';

// A 1 s clock for "Updated 4s ago". One interval for the whole page, only
// while something listens. The server snapshot is null, so the relative text
// renders after hydration and never mismatches.

let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot(): number {
  if (!now) now = Date.now();
  return now;
}

const getServerSnapshot = () => null;

/** Current time in ms, ticking each second; null during server render and hydration. */
export function useClock(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
