'use client';

import type { LiveDto, OnlineDto } from '@/features/admin/analytics/types';
import { LIVE_POLL_MS, LIVE_URL, ONLINE_POLL_MS, ONLINE_URL } from '../poll';
import { usePoll, type PollResult } from './usePoll';

export const LIVE_QUERY_KEY = ['admin', 'live'] as const;
export const ONLINE_QUERY_KEY = ['admin', 'online'] as const;

/** Live page: full payload every 30 s, first data from the server render. */
export function useLivePoll(initial: LiveDto, paused: boolean): PollResult<LiveDto> {
  return usePoll<LiveDto>({
    queryKey: LIVE_QUERY_KEY,
    url: LIVE_URL,
    intervalMs: LIVE_POLL_MS,
    initial: { data: initial, at: Date.parse(initial.at) },
    paused,
  });
}

/** "N online": one `count()` every 60 s, shared by the top bar and the Overview badge. */
export function useOnlineCount({ enabled = true, poll = true }: { enabled?: boolean; poll?: boolean } = {}): PollResult<OnlineDto> {
  return usePoll<OnlineDto>({ queryKey: ONLINE_QUERY_KEY, url: ONLINE_URL, intervalMs: ONLINE_POLL_MS, enabled, poll });
}
