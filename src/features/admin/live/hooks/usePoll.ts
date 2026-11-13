'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  applyPoll,
  initialSnapshot,
  outcomeFromResponse,
  pollInterval,
  pollMode,
  refetchOnReturn,
  type PollMode,
  type PollOutcome,
  type PollSnapshot,
} from '../poll';
import { useIdle, useOnline, usePageVisible } from './usePollGate';

type UsePollOptions<T> = {
  queryKey: QueryKey;
  url: string;
  intervalMs: number;
  /** Server-rendered first data: no client fetch on first paint. */
  initial?: { data: T; at: number };
  /** The Pause button. */
  paused?: boolean;
  /** false: no fetch at all (e.g. the top-bar count under 1024 px). */
  enabled?: boolean;
  /**
   * false: read the shared cache and fetch once if it is empty, but leave the
   * interval to another observer (the Overview badge when the top bar polls).
   */
  poll?: boolean;
};

export type PollResult<T> = {
  snapshot: PollSnapshot<T>;
  mode: PollMode;
  /** Fetch now (Resume, Retry). */
  refetch: () => void;
  /** Leave the idle pause and fetch at once. */
  resumeIdle: () => void;
};

async function fetchOutcome<T>(url: string, signal: AbortSignal): Promise<PollOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' }, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: 'failed' };
  }
  const body: unknown = await res.json().catch(() => null);
  return outcomeFromResponse<T>(res.status, body);
}

/** One poll: fetch, then fold the outcome into the cached snapshot. */
async function pollOnce<T>(prev: PollSnapshot<T>, url: string, signal: AbortSignal): Promise<PollSnapshot<T>> {
  const outcome = await fetchOutcome<T>(url, signal);
  return applyPoll(prev, outcome, Date.now());
}

/**
 * A poll that follows T-26: every `intervalMs` while the tab is visible and
 * online, never in the background, stopped after 10 min idle, by the Pause
 * button, by the read budget, a 401 / 403 or 3 failures in a row. A failed
 * poll keeps the last data (no error screen). Polls swap data in place: no
 * refreshing state (06-states.md).
 */
export function usePoll<T>({ queryKey, url, intervalMs, initial, paused = false, enabled = true, poll = true }: UsePollOptions<T>): PollResult<T> {
  const client = useQueryClient();
  const visible = usePageVisible();
  const online = useOnline();
  const [idle, resume] = useIdle();
  const gate = { visible, online, idle, paused };

  const query = useQuery<PollSnapshot<T>>({
    queryKey,
    queryFn: async ({ signal }) => {
      const prev = client.getQueryData<PollSnapshot<T>>(queryKey) ?? initialSnapshot<T>(initial?.data ?? null, initial?.at ?? null);
      return pollOnce(prev, url, signal);
    },
    initialData: initial ? initialSnapshot(initial.data, initial.at) : undefined,
    initialDataUpdatedAt: initial?.at,
    // Server-seeded polls drop their cache on unmount, so coming back shows the
    // fresh server render instead of an older cached poll.
    ...(initial ? { gcTime: 0 } : {}),
    enabled,
    staleTime: 0,
    // A first observer with no server data fetches once; later ones share the cache.
    refetchOnMount: (q) => q.state.data === undefined,
    refetchInterval: (q) => (poll ? pollInterval(pollMode(gate, q.state.data?.status ?? 'ok'), intervalMs) : false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (q) => poll && refetchOnReturn(gate, q.state.data?.status ?? 'ok'),
    refetchOnReconnect: (q) => poll && refetchOnReturn(gate, q.state.data?.status ?? 'ok'),
    retry: false,
  });

  const snapshot = query.data ?? initialSnapshot<T>();
  const { refetch } = query;
  const refetchNow = useCallback(() => void refetch(), [refetch]);
  const resumeIdle = useCallback(() => {
    resume();
    void refetch();
  }, [resume, refetch]);

  return { snapshot, mode: pollMode(gate, snapshot.status), refetch: refetchNow, resumeIdle };
}
