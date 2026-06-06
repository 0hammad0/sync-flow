'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { clientAuth, clientDb } from '@/lib/firebase/client';
import { formatTimeUntil } from '@/lib/time';
import LoadingSpinner from './LoadingSpinner';
import Button from './ui/Button';
import { MessageSquare } from 'lucide-react';
import type { ChatRoom } from '@/types';

/**
 * Live-updating list of the signed-in user's chat rooms. Subscribes via
 * Firestore onSnapshot so newly created rooms appear instantly and expired
 * rooms disappear without a page refresh.
 */
export default function MyChatRooms() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexError, setIndexError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Auth listener.
  useEffect(() => {
    const unsub = onAuthStateChanged(clientAuth(), (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Realtime subscription, scoped to this user's rooms. If the user logs out
  // the auth check below renders null so stale `rooms` are never shown — no
  // need to reset state here.
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(clientDb(), 'rooms'),
      where('created_by', '==', user.uid),
      orderBy('created_at', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRooms(snap.docs.map((d) => d.data() as ChatRoom));
        setLoading(false);
        setIndexError(false);
      },
      (err) => {
        console.error('MyChatRooms snapshot error:', err);
        setLoading(false);
        if (/requires an index/i.test(err.message)) setIndexError(true);
      }
    );
    return () => unsub();
  }, [user]);

  // Re-render every 30s so the "expires in" countdown updates and expired
  // rooms drop out of the active list.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!authReady) return null;
  if (!user) return null;

  // Drop expired rooms client-side. `now` is state, ticked every 30s, so this
  // recomputes deterministically without an impure call during render.
  const active = rooms.filter((r) => new Date(r.expires_at).getTime() > now);

  return (
    <section className="mt-8 sm:mt-10">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-fg">My Chat Rooms</h2>
          <p className="text-xs text-fg-muted mt-0.5">
            Live list of rooms you&apos;ve created. Auto-deletes when they expire.
          </p>
        </div>
        <Button href="/chat" variant="primary" size="sm" className="shrink-0">
          New Room
        </Button>
      </div>

      {indexError && (
        <div className="mb-3 p-3 bg-warning/10 border border-warning/20 rounded-2xl">
          <p className="text-xs text-warning-text">
            Firestore composite index is still building for the rooms list. This list will
            populate once it finishes (1–3 min).
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <LoadingSpinner size="md" className="text-fg-faint" />
        </div>
      ) : active.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-edge-strong rounded-2xl">
          <span className="inline-flex w-10 h-10 mb-2 rounded-xl bg-brand/10 text-brand-text items-center justify-center">
            <MessageSquare className="w-5 h-5" />
          </span>
          <p className="text-sm text-fg-muted">No active rooms</p>
          <p className="text-xs text-fg-faint mt-1">
            Created rooms will show here while they&apos;re still alive.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {active.map((r) => (
            <li
              key={r.code}
              className="flex items-center justify-between gap-3 p-3 bg-surface border border-edge rounded-2xl card-hover animate-fade-in"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg truncate">
                  {r.name || 'Untitled room'}
                </p>
                <p className="text-xs text-fg-muted mt-0.5">
                  <span className="font-mono tracking-widest text-brand-text">{r.code}</span>
                  <span className="mx-1.5">&middot;</span>
                  <span title={new Date(r.expires_at).toLocaleString()}>
                    expires in {formatTimeUntil(r.expires_at)}
                  </span>
                </p>
              </div>
              <Link
                href={`/chat/${r.code}`}
                className="shrink-0 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg bg-brand/10 text-brand-text hover:bg-brand/20 cursor-pointer transition-colors"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
