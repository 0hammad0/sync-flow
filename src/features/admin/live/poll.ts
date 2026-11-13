// Polling rules for Live (30 s) and the "N online" count (60 s), T-26
// (03-live.md "Refresh", 06-states.md "Polls"). Pure, so the rules are unit
// tested without timers or a browser. The hooks in ./hooks wire them to
// TanStack Query, the Page Visibility API and the idle watcher.

export const LIVE_POLL_MS = 30_000;
export const ONLINE_POLL_MS = 60_000;
/** No pointer, key, wheel, scroll or touch input for this long → polling stops. */
export const IDLE_AFTER_MS = 10 * 60_000;
/** Consecutive failed polls before "Live updates stopped." */
export const MAX_FAILURES = 3;

export const LIVE_URL = '/api/admin/live';
export const ONLINE_URL = '/api/admin/live?only=count';

/** What one poll gave back. */
export type PollOutcome<T> =
  | { kind: 'ok'; data: T }
  /** Today's admin read budget is used up: stop until 00:00 UTC. */
  | { kind: 'budget' }
  /** Network error, 5xx or a body we cannot read: keep the old data, try again. */
  | { kind: 'failed' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' };

export type PollStatus = 'ok' | 'failing' | 'stopped' | 'budget' | 'unauthorized' | 'forbidden';

/** The cached value of a poll: the last good data plus how the polls are going. */
export type PollSnapshot<T> = {
  data: T | null;
  status: PollStatus;
  /** Failed polls in a row. */
  failures: number;
  /** When `data` arrived (ms). */
  updatedAt: number | null;
};

export function initialSnapshot<T>(data: T | null = null, updatedAt: number | null = null): PollSnapshot<T> {
  return { data, status: 'ok', failures: 0, updatedAt };
}

/** Next snapshot after a poll. Failures and stops never drop the last good data. */
export function applyPoll<T>(prev: PollSnapshot<T>, outcome: PollOutcome<T>, now: number): PollSnapshot<T> {
  switch (outcome.kind) {
    case 'ok':
      return { data: outcome.data, status: 'ok', failures: 0, updatedAt: now };
    case 'failed': {
      const failures = prev.failures + 1;
      return { ...prev, failures, status: failures >= MAX_FAILURES ? 'stopped' : 'failing' };
    }
    default:
      return { ...prev, status: outcome.kind };
  }
}

/** Route response → outcome. The route answers with the data layer's QueryResult as JSON. */
export function outcomeFromResponse<T>(status: number, body: unknown): PollOutcome<T> {
  if (status === 401) return { kind: 'unauthorized' };
  if (status === 403) return { kind: 'forbidden' };
  const result = body as { state?: unknown; data?: unknown } | null;
  if (status === 200 && result?.state === 'ok' && result.data != null) return { kind: 'ok', data: result.data as T };
  if (result?.state === 'budget') return { kind: 'budget' };
  return { kind: 'failed' };
}

/** What the page and the user allow right now. */
export type PollGate = {
  visible: boolean;
  /** 10 min without input. */
  idle: boolean;
  /** The Pause button (`?paused=1`). */
  paused: boolean;
  online: boolean;
};

export type PollMode = 'running' | 'hidden' | 'offline' | 'idle' | 'paused' | 'stopped';

/**
 * Why polling is (not) running. A stop that needs the user (budget, signed
 * out, no access, 3 failures) wins over everything; then the user's own
 * pause, then idle, offline and a hidden tab.
 */
export function pollMode(gate: PollGate, status: PollStatus): PollMode {
  if (status === 'stopped' || status === 'budget' || status === 'unauthorized' || status === 'forbidden') return 'stopped';
  if (gate.paused) return 'paused';
  if (gate.idle) return 'idle';
  if (!gate.online) return 'offline';
  if (!gate.visible) return 'hidden';
  return 'running';
}

/** TanStack `refetchInterval`: the interval only while running, else off. */
export function pollInterval(mode: PollMode, intervalMs: number): number | false {
  return mode === 'running' ? intervalMs : false;
}

/**
 * Refetch when the tab comes back or the network returns: only if polling
 * would run (not while paused, idle or stopped).
 */
export function refetchOnReturn(gate: Omit<PollGate, 'visible' | 'online'>, status: PollStatus): boolean {
  return pollMode({ ...gate, visible: true, online: true }, status) === 'running';
}

/** `now`, `45s ago`, `3m ago`, `5h ago` (11-copy.md "Time"). */
export function formatAgoShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s === 0) return 'now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
