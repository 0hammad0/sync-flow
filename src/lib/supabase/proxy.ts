'use server';

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Updates the Supabase auth session by refreshing tokens.
 * This function handles:
 * 1. Refreshing expired auth tokens
 * 2. Passing refreshed tokens to Server Components via request.cookies
 * 3. Passing refreshed tokens to browser via response.cookies
 * 4. Protecting routes that require authentication
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // First, set cookies on the request (for Server Components)
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Create new response with updated request
          supabaseResponse = NextResponse.next({
            request,
          });
          // Then, set cookies on the response (for browser)
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session - this is critical for keeping users logged in
  // IMPORTANT: Use getUser() as it validates the JWT, unlike getSession()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // Protect dashboard route - redirect to login if not authenticated
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    if (error || !user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
