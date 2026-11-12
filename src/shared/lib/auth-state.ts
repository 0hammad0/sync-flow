'use client';

import { useSyncExternalStore } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { clientAuth } from '@/shared/lib/firebase/client';

/**
 * One shared Firebase auth listener for the whole app shell.
 *
 * Signed-in vs signed-out UI is chosen before first paint: the inline script
 * in the root layout copies a localStorage hint onto <html data-auth="in">,
 * and CSS (`.when-signed-in` / `.when-signed-out` in globals.css) shows the
 * matching variant. This store keeps that hint honest once Firebase resolves,
 * so pages can stay statically rendered and nothing flashes a spinner.
 */

export const AUTH_HINT_KEY = 'sf-auth';

let signedIn: boolean | null = null; // null until Firebase resolves
let started = false;
const listeners = new Set<() => void>();

function readHint(): boolean {
  return document.documentElement.getAttribute('data-auth') === 'in';
}

function applyHint(next: boolean) {
  const root = document.documentElement;
  if (next) root.setAttribute('data-auth', 'in');
  else root.removeAttribute('data-auth');
  try {
    if (next) window.localStorage.setItem(AUTH_HINT_KEY, '1');
    else window.localStorage.removeItem(AUTH_HINT_KEY);
  } catch {
    /* storage blocked — the attribute still applies for this page */
  }
}

function start() {
  if (started) return;
  started = true;
  onAuthStateChanged(clientAuth(), (user) => {
    signedIn = !!user;
    applyHint(signedIn);
    listeners.forEach((l) => l());
  });
}

function subscribe(onChange: () => void) {
  start();
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): boolean {
  return signedIn ?? readHint();
}

// Server render: signed out. The client corrects it right after hydration.
function getServerSnapshot(): boolean {
  return false;
}

/** Best-known signed-in state: the pre-paint hint, then Firebase's answer. */
export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Clear the hint immediately (e.g. on sign-out, before the redirect). */
export function clearAuthHint() {
  signedIn = false;
  applyHint(false);
  listeners.forEach((l) => l());
}
