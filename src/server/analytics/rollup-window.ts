import 'server-only';

import { addRollup, emptyRollup, hourKey, hoursOfDay, type Rollup } from '@/server/analytics/model';
import type { EventReader } from '@/server/repositories/interfaces';
import type { Granularity, RangeMeta } from './dto';

/**
 * Which rollup docs a date range reads, and how they merge. The rule
 * (phase-3 step 3.2): past days read `a_daily` (1 doc per day), today reads
 * its `a_hourly` docs; never raw sessions for totals. Everything here is
 * JSON-safe so a RollupSet can sit in the Next data cache.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Past days still rebuilt by the nightly cron. When one has no `a_daily`
 * doc yet (cron failed or not run), its 24 `a_hourly` docs are read instead
 * (02-overview.md edge case 5). Older days are never rebuilt, so a missing
 * doc there just means "no data" and costs nothing extra.
 */
export const HOURLY_FALLBACK_DAYS = 2;

/** The range fields this module needs (ResolvedRange from the admin feature fits). */
export type AnalyticsRange = { kind: string; from: string; to: string; granularity: Granularity };

export type RollupWindow = {
  granularity: Granularity;
  /** Past UTC days read from `a_daily`, oldest first. */
  days: string[];
  /** `a_hourly` ids, oldest first: today so far (day granularity), or the hours themselves. */
  hours: string[];
  /** Day granularity: the day the `hours` add up to (today), else null. */
  hoursDay: string | null;
  from: string;
  to: string;
};

export type SlotTotals = {
  /** Day or hour id. */
  key: string;
  views: number;
  sessions: number;
  bounces: number;
  engaged_ms: number;
  sampled: boolean;
  /** No doc for this slot. */
  missing: boolean;
  /** Views per encoded path key (page trend). */
  paths: Record<string, number>;
};

export type RollupSet = {
  merged: Rollup;
  slots: SlotTotals[];
  /** Days rebuilt from `a_hourly` because `a_daily` was missing. */
  fallbackDays: string[];
};

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function shiftDay(day: string, n: number): string {
  return utcDay(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS);
}

function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d);
  return out;
}

/** `count` hour ids ending with the hour of `endMs`, oldest first. */
function hoursEndingAt(endMs: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => hourKey(new Date(endMs - (count - 1 - i) * HOUR_MS)));
}

/** Start of a day or hour slot, ISO. */
export function slotStart(key: string): string {
  return key.length > 10 ? `${key.slice(0, 10)}T${key.slice(11, 13)}:00:00.000Z` : `${key}T00:00:00.000Z`;
}

function dayWindow(from: string, to: string, today: string, nowMs: number): RollupWindow {
  const all = dayList(from, to);
  const hasToday = to >= today;
  return {
    granularity: 'day',
    days: all.filter((d) => d < today),
    hours: hasToday ? hoursOfDay(today).slice(0, new Date(nowMs).getUTCHours() + 1) : [],
    hoursDay: hasToday ? today : null,
    from,
    to,
  };
}

function hourWindow(hours: string[]): RollupWindow {
  return {
    granularity: 'hour',
    days: [],
    hours,
    hoursDay: null,
    from: hours[0]?.slice(0, 10) ?? '',
    to: hours.at(-1)?.slice(0, 10) ?? '',
  };
}

/**
 * The docs a range reads now, and its previous period of the same length:
 * - `today`: today's hours so far vs the same hours yesterday
 * - `24h`: the last 24 hours vs the 24 before
 * - day ranges: N days (today as its hours so far) vs the N days before
 */
export function rangeWindows(range: AnalyticsRange, nowMs: number): { current: RollupWindow; previous: RollupWindow } {
  const today = utcDay(nowMs);
  if (range.kind === 'today') {
    const count = new Date(nowMs).getUTCHours() + 1;
    return {
      current: hourWindow(hoursEndingAt(nowMs, count)),
      previous: hourWindow(hoursEndingAt(nowMs - DAY_MS, count)),
    };
  }
  if (range.kind === '24h') {
    return {
      current: hourWindow(hoursEndingAt(nowMs, 24)),
      previous: hourWindow(hoursEndingAt(nowMs - DAY_MS, 24)),
    };
  }
  const length = dayList(range.from, range.to).length;
  return {
    current: dayWindow(range.from, range.to, today, nowMs),
    previous: dayWindow(shiftDay(range.from, -length), shiftDay(range.from, -1), today, nowMs),
  };
}

/** Past days that may fall back to `a_hourly` (yesterday and the day before). */
export function fallbackDaysFor(days: string[], nowMs: number): string[] {
  const today = utcDay(nowMs);
  const first = shiftDay(today, -HOURLY_FALLBACK_DAYS);
  return days.filter((d) => d >= first && d < today);
}

function toSlot(key: string, r: Rollup | null): SlotTotals {
  const paths: Record<string, number> = {};
  for (const [p, stats] of Object.entries(r?.path ?? {})) paths[p] = stats.views;
  return {
    key,
    views: r?.views ?? 0,
    sessions: r?.sessions ?? 0,
    bounces: r?.bounces ?? 0,
    engaged_ms: r?.engaged_ms ?? 0,
    sampled: r?.sampled ?? false,
    missing: r === null,
    paths,
  };
}

function sumRollups(docs: (Rollup | null)[]): Rollup | null {
  const present = docs.filter((d): d is Rollup => d !== null);
  return present.length === 0 ? null : present.reduce((acc, d) => addRollup(acc, d), emptyRollup());
}

/** Sum of slots as one slot (today's hours shown as one day). */
function collapse(key: string, slots: SlotTotals[]): SlotTotals {
  const out = toSlot(key, null);
  out.missing = slots.every((s) => s.missing);
  for (const s of slots) {
    out.views += s.views;
    out.sessions += s.sessions;
    out.bounces += s.bounces;
    out.engaged_ms += s.engaged_ms;
    out.sampled ||= s.sampled;
    for (const [p, v] of Object.entries(s.paths)) out.paths[p] = (out.paths[p] ?? 0) + v;
  }
  return out;
}

export const EMPTY_SET: RollupSet = { merged: emptyRollup(), slots: [], fallbackDays: [] };

/** Where rollup docs come from. Production wraps it in the Next cache; tests read the repo directly. */
export interface RollupSource {
  /** Past days from `a_daily`; days in `hourlyFallback` with no doc are rebuilt from `a_hourly`. */
  days(days: string[], hourlyFallback: string[]): Promise<RollupSet>;
  /** `a_hourly` docs, one slot per hour. */
  hours(hours: string[]): Promise<RollupSet>;
}

/**
 * Reads straight from the repository. Cost: 1 read per day + 1 per hour,
 * plus 24 per fallback day that turns out to be missing.
 */
export function rollupSourceFrom(reader: Pick<EventReader, 'readDaily' | 'readHourly'>): RollupSource {
  return {
    async days(days, hourlyFallback) {
      if (days.length === 0) return EMPTY_SET;
      const docs: (Rollup | null)[] = await reader.readDaily(days);
      const fallback = new Set(hourlyFallback);
      const rebuild = days.filter((d, i) => docs[i] === null && fallback.has(d));
      const fallbackDays: string[] = [];
      if (rebuild.length > 0) {
        const hourly = await reader.readHourly(rebuild.flatMap((d) => hoursOfDay(d)));
        rebuild.forEach((day, n) => {
          const sum = sumRollups(hourly.slice(n * 24, n * 24 + 24));
          if (sum) {
            docs[days.indexOf(day)] = sum;
            fallbackDays.push(day);
          }
        });
      }
      return { merged: sumRollups(docs) ?? emptyRollup(), slots: days.map((d, i) => toSlot(d, docs[i])), fallbackDays };
    },
    async hours(hours) {
      if (hours.length === 0) return EMPTY_SET;
      const docs = await reader.readHourly(hours);
      return { merged: sumRollups(docs) ?? emptyRollup(), slots: hours.map((h, i) => toSlot(h, docs[i])), fallbackDays: [] };
    },
  };
}

/** `a` then `b` (slots in that order), merged with `addRollup`. */
export function concatSets(a: RollupSet, b: RollupSet): RollupSet {
  if (a.slots.length === 0) return b;
  if (b.slots.length === 0) return a;
  return {
    merged: addRollup(a.merged, b.merged),
    slots: [...a.slots, ...b.slots],
    fallbackDays: [...a.fallbackDays, ...b.fallbackDays],
  };
}

/** Reads one window: past days + today's hours merged (`addRollup`), or the hours themselves. */
export async function loadWindow(source: RollupSource, window: RollupWindow, nowMs: number): Promise<RollupSet> {
  const [days, hours] = await Promise.all([
    window.days.length > 0 ? source.days(window.days, fallbackDaysFor(window.days, nowMs)) : EMPTY_SET,
    window.hours.length > 0 ? source.hours(window.hours) : EMPTY_SET,
  ]);
  if (window.granularity === 'hour') return hours;
  const slots = window.hoursDay ? [...days.slots, collapse(window.hoursDay, hours.slots)] : days.slots;
  return { merged: addRollup(days.merged, hours.merged), slots, fallbackDays: days.fallbackDays };
}

export function metaOf(window: RollupWindow, set: RollupSet): RangeMeta {
  const sampledDays = [...new Set(set.slots.filter((s) => s.sampled).map((s) => s.key.slice(0, 10)))];
  return {
    from: window.from,
    to: window.to,
    granularity: window.granularity,
    sampled: sampledDays.length > 0,
    sampledDays,
    fallbackDays: set.fallbackDays,
  };
}
