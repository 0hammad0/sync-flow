'use client';

import { useState } from 'react';
import AdminButton from '@/shared/ui/AdminButton';
import { signOutAdmin } from './sign-out';

/** "Sign out" on the forbidden screen. No confirm (01-auth.md). */
export default function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    const result = await signOutAdmin();
    // On success the page is already navigating away; keep the spinner.
    if (!result.ok) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <>
      <AdminButton onClick={onClick} loading={pending} loadingText="Signing out…">
        Sign out
      </AdminButton>
      {error && (
        // Own row under the buttons (the parent is a wrapping flex row).
        <p role="alert" className="order-last basis-full text-xs text-danger-text">
          {error}
        </p>
      )}
    </>
  );
}
