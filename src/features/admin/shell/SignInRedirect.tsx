'use client';

import type { ReactNode } from 'react';
import { redirect, usePathname, useSearchParams } from 'next/navigation';
import { signInHref, type SignInNotice } from './account';

/**
 * Sends a request with no usable session to the sign-in page, returning to
 * the exact path + query. A layout cannot read the current path on the
 * server, but a client leaf can (also during SSR), so the redirect still
 * happens in the server render on a full page load.
 */
export default function SignInRedirect({ notice }: { notice?: SignInNotice }): ReactNode {
  const pathname = usePathname() ?? '/admin';
  const search = useSearchParams()?.toString() ?? '';
  return redirect(signInHref(pathname, search, notice));
}
