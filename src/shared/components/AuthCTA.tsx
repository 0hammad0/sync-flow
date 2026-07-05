'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { clientAuth } from '@/shared/lib/firebase/client';
import { CheckCircle2, UserRound } from 'lucide-react';

export default function AuthCTA() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(clientAuth(), (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) return null;

  if (user) {
    return (
      <div className="mt-4 p-4 bg-success/10 border border-success/20 rounded-2xl animate-fade-in">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-success-text mt-0.5" />
          <div>
            <p className="text-sm text-fg font-medium">
              You&apos;re signed in!
            </p>
            <p className="text-xs text-fg-muted mt-0.5">
              <Link href="/dashboard" className="text-success-text underline hover:no-underline font-medium">
                Go to your dashboard
              </Link>
              {' '}to view and manage your uploaded files.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 p-4 bg-brand/5 border border-brand/15 rounded-2xl animate-fade-in">
      <div className="flex items-start gap-3">
        <UserRound className="w-5 h-5 shrink-0 text-brand-text mt-0.5" />
        <div>
          <p className="text-sm text-fg font-medium">
            Want to manage your files?
          </p>
          <p className="text-xs text-fg-muted mt-0.5">
            <Link href="/login" className="text-brand-text underline hover:no-underline font-medium">
              Sign in
            </Link>
            {' '}to view, organize, and delete your uploaded files anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
