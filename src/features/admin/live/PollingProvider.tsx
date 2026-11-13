'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// TanStack Query only where the admin polls (T-10): the top-bar count, the
// Overview "online now" badge and Live. Each wraps itself in this provider;
// in the browser they share one client, so the top bar and the Overview badge
// read the same cached count (one request per minute, not two). The server
// gets a fresh client per render, so nothing leaks between requests.

let browserClient: QueryClient | undefined;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnMount: false, gcTime: 5 * 60_000 },
    },
  });
}

function getClient(): QueryClient {
  if (typeof window === 'undefined') return makeClient();
  browserClient ??= makeClient();
  return browserClient;
}

export default function PollingProvider({ children }: { children: ReactNode }) {
  const [client] = useState(getClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
