// Pure status rules for the tracking part of Health (14-health.md "Checks",
// "Quota meters and banners"). No server or React imports.

import type { CheckStatus } from './cron-status';

export type QuotaKind = 'reads' | 'writes' | 'deletes';
export const QUOTA_KINDS: readonly QuotaKind[] = ['writes', 'reads', 'deletes'];

/** Today's QuotaGuard numbers as the page sees them (JSON safe). */
export type QuotaUsageDto = {
  /** UTC day of the counters, e.g. `2026-11-13`. */
  day: string;
  used: Record<QuotaKind, number>;
  caps: Record<QuotaKind, number>;
  /** True when admin_config/settings sets no caps (the code defaults apply). */
  defaultCaps: boolean;
  /** ISO time until which Firestore's RESOURCE_EXHAUSTED stop holds, else null. */
  stoppedUntil: string | null;
};

/** Same threshold as QuotaGuard's write sampling. */
export const WARN_RATIO = 0.7;

export function quotaRatio(used: number, cap: number): number {
  return cap > 0 ? used / cap : 0;
}

export function meterStatus(used: number, cap: number): CheckStatus {
  const ratio = quotaRatio(used, cap);
  if (ratio >= 1) return 'fail';
  if (ratio >= WARN_RATIO) return 'warn';
  return 'ok';
}

const WHAT_STOPS: Record<QuotaKind, string> = {
  writes: 'Tracking is paused.',
  reads: 'Admin pages show cached numbers.',
  deletes: 'Retention cleanup is paused.',
};

export type QuotaBanner = { tone: 'warning' | 'danger'; text: string };

/** The amber (≥ 70 %) or red (≥ 100 %, or Firestore stopped us) banner, or null. */
export function quotaBanner(usage: QuotaUsageDto): QuotaBanner | null {
  if (usage.stoppedUntil) {
    return {
      tone: 'danger',
      text: "Firestore's daily free quota is used up. Tracking and admin reads are paused until midnight Pacific time.",
    };
  }
  const full = QUOTA_KINDS.filter((k) => meterStatus(usage.used[k], usage.caps[k]) === 'fail');
  if (full.length > 0) {
    return {
      tone: 'danger',
      text: `Today's Firestore ${list(full)} budget is used up. ${full.map((k) => WHAT_STOPS[k]).join(' ')} It resets at 00:00 UTC.`,
    };
  }
  const high = QUOTA_KINDS.filter((k) => meterStatus(usage.used[k], usage.caps[k]) === 'warn');
  if (high.length === 0) return null;
  const worst = Math.max(...high.map((k) => quotaRatio(usage.used[k], usage.caps[k])));
  const sampled = high.includes('writes') ? ' Tracking is sampled: 1 in 2 sessions is kept.' : '';
  return {
    tone: 'warning',
    text: `Firestore ${list(high)} at ${Math.floor(worst * 100)}% of today's admin + tracker cap.${sampled}`,
  };
}

function list(kinds: QuotaKind[]): string {
  return kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} and ${kinds.at(-1)}`;
}

/** Tracker sampling today, from the write meter (QuotaGuard samples at 70 %, stops at 100 %). */
export function samplingStatus(usage: QuotaUsageDto): { status: CheckStatus; reason: string } {
  if (usage.stoppedUntil) return { status: 'fail', reason: 'Stopped: Firestore quota used up.' };
  const status = meterStatus(usage.used.writes, usage.caps.writes);
  if (status === 'fail') return { status, reason: 'Stopped for today: write cap reached.' };
  if (status === 'warn') return { status, reason: 'On today: 1 in 2 sessions is kept.' };
  return { status: 'ok', reason: 'Off: every session is kept.' };
}

/** `a_counters/{day}.ingest.*`, summed over today and yesterday (UTC). */
export type IngestCounts = { accepted: number; dropped: number; sampledOut: number; error: number };

export type IngestCheck = { status: CheckStatus; reason: string; total: number; errorRate: number };

/** 14-health.md "Ingest error rate": < 1 % OK, 1–5 % Warn, > 5 % Fail, or nothing at all while on. */
export function ingestCheck(enabled: boolean, counts: IngestCounts): IngestCheck {
  const total = counts.accepted + counts.dropped + counts.sampledOut + counts.error;
  const tried = counts.accepted + counts.error;
  const errorRate = tried > 0 ? counts.error / tried : 0;
  if (!enabled) return { status: 'no_data', reason: 'Tracking is off.', total, errorRate };
  if (total === 0) return { status: 'fail', reason: 'No events in the last 24 hours while tracking is on.', total, errorRate };
  if (errorRate > 0.05) return { status: 'fail', reason: 'More than 5% of events failed to save.', total, errorRate };
  if (errorRate >= 0.01) return { status: 'warn', reason: 'Some events failed to save (1–5%).', total, errorRate };
  return { status: 'ok', reason: 'Events are arriving and saving.', total, errorRate };
}
