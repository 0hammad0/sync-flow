'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { clientAuth } from '@/lib/firebase/client';

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
      <div className="mt-4 p-4 bg-green-50 border border-green-100 rounded-lg">
        <div className="flex items-start gap-3">
          <span className="text-green-500 text-lg">✓</span>
          <div>
            <p className="text-sm text-green-800 font-medium">
              You&apos;re signed in!
            </p>
            <p className="text-xs text-green-600 mt-0.5">
              <Link href="/dashboard" className="underline hover:no-underline">
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
    <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-lg">
      <div className="flex items-start gap-3">
        <span className="text-blue-500 text-lg">💡</span>
        <div>
          <p className="text-sm text-blue-800 font-medium">
            Want to manage your files?
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            <Link href="/login" className="underline hover:no-underline">
              Sign in
            </Link>
            {' '}to view, organize, and delete your uploaded files anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
