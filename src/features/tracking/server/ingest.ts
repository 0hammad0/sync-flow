import 'server-only';

import { randomUUID } from 'node:crypto';

import { referrerHost } from '@/features/tracking/normalise-path';
import {
  MAX_BODY_BYTES,
  parseBeacon,
  type Beacon,
  type EngageEvent,
  type PageviewEvent,
  type VitalsEvent,
} from '@/features/tracking/schemas';
import {
  DEFAULT_TRACKING_SETTINGS,
  applySessionPatch,
  dayKey,
  rollupHour,
  sessionRollup,
  type SessionPatch,
  type SessionSetFields,
  type TrackingSettings,
} from '@/server/analytics/model';
import type { BlockHit, BlockSubject } from '@/server/blocklist/find-block';
import type { QuotaMeter } from '@/server/quota/quota-guard';
import type { EventRepository, HourlyIncrement } from '@/server/repositories/interfaces';
import { rateLimit } from '@/shared/lib/rate-limit';

import { dailyVisitorHash, enrich, type Enriched, type RequestMeta } from './enrich';

/**
 * `/api/e` ingest. Two halves:
 * - `acceptBeacon` runs BEFORE the 204: origin check, per-IP rate limit, size
 *   and count caps, zod. Memory only, no Firestore.
 * - `IngestService.ingest` runs inside `after()`: kill switch → bot → blocklist
 *   (all drop before any write) → QuotaGuard → one set/merge on the session.
 *   The final flush also reads the session once and adds its rollup to
 *   `a_hourly` in the same batch. It never throws.
 *
 * Firestore cost per flush (tracking on, not dropped): 1 write; the final
 * flush adds 1 read + 1 write. Plus, per instance: the settings read (≤ 1 per
 * 60 s) and the buffered ingest counters (≤ 1 write per 5 min or 200 events).
 *
 * Spec: docs/admin/01-architecture/07-tracker.md ("Ingest /api/e").
 */

// ---------------------------------------------------------------------------
// Before the response
// ---------------------------------------------------------------------------

/** Flushes per IP per minute. A tab sends ~1/min; this leaves room for shared NATs. */
export const RATE_LIMIT_PER_MINUTE = 60;

/** True if `Origin` (or, without it, `Referer`) is one of our hosts. Neither header → refused. */
export function originAllowed(headers: Headers, allowedHosts: readonly string[]): boolean {
  const origin = headers.get('origin');
  const source = origin && origin !== 'null' ? origin : headers.get('referer');
  if (!source) return false;
  try {
    return allowedHosts.includes(new URL(source).host);
  } catch {
    return false;
  }
}

/** Reads the body as text, giving up (null) as soon as it passes `max` bytes. */
export async function readCappedText(request: Request, max = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export type AcceptOptions = {
  allowedHosts: readonly string[];
  ip: string | null;
  limit?: (key: string) => boolean;
};

/**
 * Everything the route does before answering 204. `null` = drop silently
 * (bad origin, rate limited, too big, too many events, not a beacon).
 */
export async function acceptBeacon(request: Request, options: AcceptOptions): Promise<Beacon | null> {
  if (!originAllowed(request.headers, options.allowedHosts)) return null;
  const limit = options.limit ?? ((key: string) => rateLimit(key, RATE_LIMIT_PER_MINUTE, 60_000).allowed);
  if (!limit(`e:${options.ip ?? 'unknown'}`)) return null;
  const text = await readCappedText(request);
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  return parseBeacon(json);
}

// ---------------------------------------------------------------------------
// Session patch (pure)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Client time, kept inside the last 24 h and never in the future. */
export function clampTs(t: number, now: Date): Date {
  const max = now.getTime();
  return new Date(Math.min(max, Math.max(max - DAY_MS, t)));
}

export type PatchContext = {
  now: Date;
  uid: string | null;
  deviceHash: string | null;
  /** Kept while sampling was on (only applied to a new session). */
  sampled: boolean;
  /** Mode B: store `ipHash`, never the IP. */
  light: boolean;
  ipHash: string | null;
  /** Our own host: a referrer equal to it is not a source. */
  selfHost: string | null;
};

/** The one set/merge for a flush. `seq === 0` (a new session) also sets the start fields. */
export function buildSessionPatch(beacon: Beacon, info: Enriched, ctx: PatchContext): SessionPatch {
  const pageviews = beacon.events
    .filter((e): e is PageviewEvent => e.type === 'pageview')
    .sort((a, b) => a.t - b.t);
  const engages = beacon.events.filter((e): e is EngageEvent => e.type === 'engage');
  const vitals = beacon.events.filter((e): e is VitalsEvent => e.type === 'vitals').at(-1);

  const set: SessionSetFields = {
    ip: ctx.light ? null : info.ip,
    ip_trunc: ctx.light ? null : info.ip_trunc,
    ip_hash: ctx.light ? ctx.ipHash : null,
    ip_held: !ctx.light && info.ip !== null,
    country: info.country,
    region: info.region,
    city: info.city,
    lat: info.lat,
    lon: info.lon,
    tz: info.tz,
    browser: info.browser,
    browser_version: info.browser_version,
    os: info.os,
    device: info.device,
  };
  if (ctx.uid) set.user_id = ctx.uid;
  if (ctx.deviceHash) set.device_hash = ctx.deviceHash;

  if (beacon.seq === 0) {
    set.started_at = ctx.now;
    set.rolled_up = false;
    set.sampled = ctx.sampled;
    set.user_id = ctx.uid;
    set.device_hash = ctx.deviceHash;
    const first = pageviews[0];
    if (first) {
      const ref = referrerHost(first.ref);
      set.entry_path = first.path;
      set.viewport_w = first.vw;
      set.viewport_h = first.vh;
      set.referrer_host = ref && ref !== ctx.selfHost ? ref : null;
      set.utm_source = first.utm_source ?? null;
      set.utm_medium = first.utm_medium ?? null;
      set.utm_campaign = first.utm_campaign ?? null;
    }
  }
  const last = pageviews.at(-1);
  if (last) set.exit_path = last.path;
  if (vitals) set.vitals = { lcp: vitals.lcp ?? null, inp: vitals.inp ?? null, cls: vitals.cls ?? null };

  const pages: SessionPatch['pages'] = {};
  for (const pv of pageviews) pages[pv.pv] = { path: pv.path, ts: clampTs(pv.t, ctx.now), engaged_ms: 0 };
  let engaged = 0;
  for (const e of engages) {
    const page = (pages[e.pv] ??= { engaged_ms: 0 });
    page.engaged_ms += e.ms;
    page.scroll_max = Math.max(page.scroll_max ?? 0, e.scroll);
    engaged += e.ms;
  }

  return { id: beacon.sid, now: ctx.now, set, increment: { pageviews: pageviews.length, engaged_ms: engaged }, pages };
}

/** Sampling keeps 1 in 2 sessions, by the session id, so every flush of a session gets the same answer. */
export function keptWhenSampling(sid: string): boolean {
  return parseInt(sid.slice(-1), 16) % 2 === 0;
}

// ---------------------------------------------------------------------------
// Buffered counters and the settings cache (per instance, in memory)
// ---------------------------------------------------------------------------

export const COUNTER_FLUSH_MS = 5 * 60_000;
export const COUNTER_FLUSH_EVENTS = 200;

export type IngestCounter = 'accepted' | 'dropped' | 'sampled_out' | 'error';

/**
 * `a_counters/{day}.ingest.*`, buffered like QuotaGuard's counts: one write
 * per instance at most every 5 min or 200 counted events. A failed write
 * keeps the counts for the next try (today and yesterday only).
 */
export class IngestCounters {
  private pending = new Map<string, Partial<Record<IngestCounter, number>>>();
  private events = 0;
  private lastFlushAt: number;

  constructor(
    private readonly write: (day: string, delta: Record<string, number>) => Promise<void>,
    private readonly now: () => number,
  ) {
    this.lastFlushAt = now();
  }

  add(name: IngestCounter, n = 1): void {
    if (n <= 0) return;
    const day = dayKey(new Date(this.now()));
    const counts = this.pending.get(day) ?? {};
    counts[name] = (counts[name] ?? 0) + n;
    this.pending.set(day, counts);
    this.events += n;
  }

  /** Writes when due. Never throws. */
  async flushIfDue(): Promise<void> {
    if (this.pending.size === 0) return;
    if (this.events < COUNTER_FLUSH_EVENTS && this.now() - this.lastFlushAt < COUNTER_FLUSH_MS) return;
    await this.flush();
  }

  async flush(): Promise<void> {
    const batch = this.pending;
    this.pending = new Map();
    this.events = 0;
    this.lastFlushAt = this.now();
    const yesterday = dayKey(new Date(this.now() - DAY_MS));
    for (const [day, delta] of batch) {
      try {
        await this.write(day, delta as Record<string, number>);
      } catch {
        if (day < yesterday) continue;
        for (const [name, n] of Object.entries(delta) as [IngestCounter, number][]) {
          const counts = this.pending.get(day) ?? {};
          counts[name] = (counts[name] ?? 0) + n;
          this.pending.set(day, counts);
        }
      }
    }
  }
}

export const SETTINGS_TTL_MS = 60_000;

/** `admin_config/settings`, read at most once per 60 s per instance. A failed read means tracking OFF (fail closed). */
export class SettingsCache {
  private value: TrackingSettings = { ...DEFAULT_TRACKING_SETTINGS };
  private readAt = Number.NEGATIVE_INFINITY;
  private loading: Promise<TrackingSettings> | null = null;

  constructor(
    private readonly load: () => Promise<TrackingSettings>,
    private readonly now: () => number,
    private readonly logger: Pick<Console, 'warn'>,
    private readonly ttlMs = SETTINGS_TTL_MS,
  ) {}

  /** The last value read, without reading. `null` until the first read on this instance. */
  peek(): TrackingSettings | null {
    return this.readAt === Number.NEGATIVE_INFINITY ? null : this.value;
  }

  get(): Promise<TrackingSettings> {
    if (this.now() - this.readAt < this.ttlMs) return Promise.resolve(this.value);
    this.loading ??= this.refresh().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async refresh(): Promise<TrackingSettings> {
    try {
      this.value = await this.load();
    } catch (error) {
      this.logger.warn('[ingest] settings read failed; tracking treated as off for 60 s', error);
      this.value = { ...DEFAULT_TRACKING_SETTINGS };
    }
    this.readAt = this.now();
    return this.value;
  }
}

// ---------------------------------------------------------------------------
// After the response
// ---------------------------------------------------------------------------

export type IngestOutcome =
  | 'disabled'
  | 'bot'
  | 'blocked'
  | 'stopped'
  | 'sampled_out'
  | 'empty'
  | 'written'
  | 'rolled_up'
  | 'error';

export type IngestDeps = {
  events: EventRepository;
  quota: QuotaMeter;
  findBlock: (subject: BlockSubject) => Promise<BlockHit | null>;
  /** Firebase uid for a session cookie, or null. Must not throw. */
  resolveUid: (sessionCookie: string) => Promise<string | null>;
  /** Same hash the chat stores for a device id. */
  hashDevice: (deviceId: string) => string | null;
  /** Mode B (light): store a daily-salted hash instead of the IP. Default: full (D-1 = yes). */
  mode?: 'full' | 'light';
  /** Secret for the mode B salt. */
  hashSecret?: string;
  now?: () => number;
  logger?: Pick<Console, 'warn' | 'error'>;
};

export class IngestService {
  private readonly now: () => number;
  private readonly logger: Pick<Console, 'warn' | 'error'>;
  private readonly settings: SettingsCache;
  readonly counters: IngestCounters;

  constructor(private readonly deps: IngestDeps) {
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger ?? console;
    this.settings = new SettingsCache(() => deps.events.readTrackingSettings(), this.now, this.logger);
    this.counters = new IngestCounters(
      (day, delta) => deps.events.incrementCounters(day, 'ingest', delta),
      this.now,
    );
  }

  /**
   * The kill switch, from the same 60 s cache as ingest (≤ 1 read per 60 s
   * per instance). For `GET /api/e`, which tells the loader whether to run.
   */
  async trackingEnabled(): Promise<boolean> {
    return (await this.settings.get()).trackingEnabled;
  }

  /** The cached kill switch without a read, or `null` before the first read. Safe before the 204. */
  peekTrackingEnabled(): boolean | null {
    return this.settings.peek()?.trackingEnabled ?? null;
  }

  /** Never throws. The outcome is for tests and logs only. */
  async ingest(beacon: Beacon, meta: RequestMeta & { host?: string | null }): Promise<IngestOutcome> {
    try {
      return await this.run(beacon, meta);
    } catch (error) {
      const errorId = randomUUID().slice(0, 8);
      this.logger.error(`[ingest] error ${errorId}`, error);
      this.counters.add('error');
      return 'error';
    } finally {
      await this.counters.flushIfDue().catch(() => {});
    }
  }

  private async run(beacon: Beacon, meta: RequestMeta & { host?: string | null }): Promise<IngestOutcome> {
    const settings = await this.settings.get();
    // Kill switch: nothing at all is written, not even counters.
    if (!settings.trackingEnabled) return 'disabled';

    const info = enrich(meta);
    if (info.isBot) {
      this.counters.add('dropped', beacon.events.length + beacon.invalid);
      return 'bot';
    }
    this.counters.add('dropped', beacon.invalid);
    const n = beacon.events.length;
    if (n === 0) return 'empty';

    const uid = meta.sessionCookie ? await this.deps.resolveUid(meta.sessionCookie) : null;
    const deviceHash = beacon.did ? this.deps.hashDevice(beacon.did) : null;
    const hit = await this.deps.findBlock({ ip: info.ip, uid, country: info.country, device: deviceHash });
    if (hit) {
      this.counters.add('dropped', n);
      return 'blocked';
    }

    const decision = await this.deps.quota.canWrite('writes');
    if (decision === 'stop') {
      this.counters.add('dropped', n);
      return 'stopped';
    }
    if (decision === 'sample' && !keptWhenSampling(beacon.sid)) {
      this.counters.add('sampled_out', n);
      return 'sampled_out';
    }

    const now = new Date(this.now());
    const light = this.deps.mode === 'light';
    const patch = buildSessionPatch(beacon, info, {
      now,
      uid,
      deviceHash,
      sampled: decision === 'sample',
      light,
      ipHash: light ? dailyVisitorHash(info.ip, meta.userAgent, dayKey(now), this.deps.hashSecret ?? '') : null,
      selfHost: meta.host ?? null,
    });

    const hourly = beacon.final ? await this.finalRollup(patch, beacon.seq) : null;
    await this.deps.events.writeSession(patch, hourly);
    this.counters.add('accepted', n);
    return hourly ? 'rolled_up' : 'written';
  }

  /**
   * Final flush: read the session once, apply this flush in memory, and
   * return its rollup for the same batch (marking `rolled_up`). If the doc is
   * missing although this is not the first flush, this beacon overtook an
   * earlier one: leave it to the nightly catch-up, or the late first flush
   * would reset `rolled_up` and count the session twice. At the read cap,
   * skip: the cron catches it up later.
   */
  private async finalRollup(patch: SessionPatch, seq: number): Promise<HourlyIncrement | null> {
    if ((await this.deps.quota.canWrite('reads')) === 'stop') return null;
    const existing = await this.deps.events.getSession(patch.id);
    if (!existing && seq > 0) {
      patch.set.rolled_up = false;
      return null;
    }
    if (existing?.rolled_up) return null;
    patch.set.rolled_up = true;
    const merged = applySessionPatch(existing, patch);
    const delta = sessionRollup(merged);
    return delta.sessions > 0 ? { hour: rollupHour(merged), delta } : null;
  }
}
