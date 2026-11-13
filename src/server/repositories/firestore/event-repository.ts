import 'server-only';

import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Query,
} from 'firebase-admin/firestore';
import { z } from 'zod';

import {
  DEFAULT_TRACKING_SETTINGS,
  DIM_MAPS,
  ROLLUP_MAP_FIELDS,
  emptyRollup,
  type DailyDoc,
  type Device,
  type Rollup,
  type SessionDoc,
  type SessionPatch,
  type TrackingSettings,
} from '@/server/analytics/model';
import { ADMIN_CONFIG_DOCS, COLLECTIONS } from '@/server/firestore/collections';
import type { QuotaKind, QuotaMeter } from '@/server/quota/quota-guard';
import type { EventRepository, HourlyIncrement } from '@/server/repositories/interfaces';

/**
 * Analytics collections on Firestore. Every call reports what it cost to
 * QuotaGuard (`record`) and feeds errors to it (`noteError`, which sets the
 * RESOURCE_EXHAUSTED stop flag). Whether a call may run at all is the
 * caller's decision (`canWrite`), made before calling.
 *
 * Cost per method:
 * - readTrackingSettings, getSession: 1 read
 * - writeSession: 1 write, 2 with the hourly rollup (one batch)
 * - rollUpSession: 2 writes (one batch)
 * - listUnrolledSessions: 1 read per doc, minimum 1
 * - getHourly: 1 read per id asked (missing docs are billed too)
 * - putDaily, incrementCounters: 1 write; getDaily, getCounters: 1 read
 * - nullIps: 1 read + 1 write per doc (min 1 read)
 * - delete*: 1 read + 1 delete per doc (min 1 read)
 */

const nullableString = z.string().nullish().catch(null).transform((v) => v ?? null);
const nullableNumber = z.number().finite().nullish().catch(null).transform((v) => v ?? null);
const count = z.number().finite().catch(0).default(0);
const date = z
  .instanceof(Timestamp)
  .nullish()
  .catch(null)
  .transform((v) => v?.toDate() ?? null);

const pageEntry = z.object({
  path: nullableString,
  ts: date,
  engaged_ms: count,
  scroll_max: count,
});

const sessionDoc = z.object({
  started_at: date,
  last_seen_at: date,
  ip: nullableString,
  ip_trunc: nullableString,
  ip_hash: nullableString,
  ip_held: z.boolean().catch(false).default(false),
  country: nullableString,
  region: nullableString,
  city: nullableString,
  lat: nullableNumber,
  lon: nullableNumber,
  tz: nullableString,
  browser: nullableString,
  browser_version: nullableString,
  os: nullableString,
  device: z
    .enum(['mobile', 'tablet', 'desktop'])
    .nullish()
    .catch(null)
    .transform((v): Device | null => v ?? null),
  viewport_w: nullableNumber,
  viewport_h: nullableNumber,
  referrer_host: nullableString,
  utm_source: nullableString,
  utm_medium: nullableString,
  utm_campaign: nullableString,
  entry_path: nullableString,
  exit_path: nullableString,
  pageviews: count,
  engaged_ms: count,
  user_id: nullableString,
  device_hash: nullableString,
  rolled_up: z.boolean().catch(false).default(false),
  sampled: z.boolean().catch(false).default(false),
  pages: z.record(z.string(), pageEntry.catch({ path: null, ts: null, engaged_ms: 0, scroll_max: 0 })).catch({}).default({}),
  vitals: z
    .object({ lcp: nullableNumber, inp: nullableNumber, cls: nullableNumber })
    .nullish()
    .catch(null)
    .transform((v) => v ?? null),
});

const settingsDoc = z.object({
  tracking_enabled: z.boolean().optional().catch(undefined),
  ip_retention_days: z.number().int().positive().optional().catch(undefined),
  raw_retention_days: z.number().int().positive().optional().catch(undefined),
});

const statsRecord = z.record(z.string(), z.record(z.string(), z.number().nullable().catch(0))).catch({}).default({});
const rollupShape = z.object({
  views: count,
  sessions: count,
  bounces: count,
  engaged_ms: count,
  sampled: z.boolean().catch(false).default(false),
  ...Object.fromEntries(ROLLUP_MAP_FIELDS.map((m) => [m, statsRecord])),
});

function parseSession(id: string, data: DocumentData | undefined): SessionDoc {
  const d = sessionDoc.parse(data ?? {});
  return { id, ...d, last_seen_at: d.last_seen_at ?? new Date(0) };
}

/** Fills missing stat fields with 0 so a partial doc still has the full shape. */
function parseRollup(data: DocumentData | undefined): Rollup {
  const parsed = rollupShape.parse(data ?? {}) as unknown as Rollup;
  const r = emptyRollup();
  r.views = parsed.views;
  r.sessions = parsed.sessions;
  r.bounces = parsed.bounces;
  r.engaged_ms = parsed.engaged_ms;
  r.sampled = parsed.sampled;
  const fill = (m: (typeof ROLLUP_MAP_FIELDS)[number], zeroes: Record<string, number | null>) => {
    const source = (parsed[m] ?? {}) as Record<string, Record<string, number | null>>;
    const target = r[m] as Record<string, Record<string, number | null>>;
    for (const [key, stats] of Object.entries(source)) target[key] = { ...zeroes, ...stats };
  };
  fill('path', { views: 0, sessions: 0, engaged_ms: 0, bounces: 0, entries: 0, exits: 0, scroll_sum: 0 });
  fill('city', { sessions: 0, views: 0, engaged_ms: 0, bounces: 0, lat: null, lon: null });
  for (const m of DIM_MAPS) fill(m, { sessions: 0, views: 0, engaged_ms: 0, bounces: 0 });
  return r;
}

function toFirestoreValue(value: unknown): unknown {
  return value instanceof Date ? Timestamp.fromDate(value) : value;
}

/** The single set/merge for one flush. Undefined fields are left out (Firestore rejects them). */
function sessionWrite(patch: SessionPatch): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch.set)) {
    if (value !== undefined) doc[key] = toFirestoreValue(value);
  }
  doc.last_seen_at = Timestamp.fromDate(patch.now);
  doc.pageviews = FieldValue.increment(patch.increment.pageviews);
  doc.engaged_ms = FieldValue.increment(patch.increment.engaged_ms);
  const pages: Record<string, Record<string, unknown>> = {};
  for (const [pv, change] of Object.entries(patch.pages)) {
    const page: Record<string, unknown> = { engaged_ms: FieldValue.increment(change.engaged_ms) };
    if (change.path !== undefined) page.path = change.path;
    if (change.ts !== undefined) page.ts = Timestamp.fromDate(change.ts);
    if (change.scroll_max !== undefined) page.scroll_max = change.scroll_max;
    pages[pv] = page;
  }
  if (Object.keys(pages).length > 0) doc.pages = pages;
  return doc;
}

/** Nested increments for set/merge (dotted keys would be literal field names in set()). */
function hourlyWrite(delta: Rollup): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    views: FieldValue.increment(delta.views),
    sessions: FieldValue.increment(delta.sessions),
    bounces: FieldValue.increment(delta.bounces),
    engaged_ms: FieldValue.increment(delta.engaged_ms),
  };
  // Only ever set to true: a later unsampled session must not clear it.
  if (delta.sampled) doc.sampled = true;
  for (const m of ROLLUP_MAP_FIELDS) {
    const entries = Object.entries(delta[m] as Record<string, Record<string, number | null>>);
    if (entries.length === 0) continue;
    const map: Record<string, Record<string, unknown>> = {};
    for (const [key, stats] of entries) {
      const out: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(stats)) {
        if (field === 'lat' || field === 'lon') {
          if (value !== null) out[field] = value;
        } else {
          out[field] = FieldValue.increment(value ?? 0);
        }
      }
      map[key] = out;
    }
    doc[m] = map;
  }
  return doc;
}

function dailyWrite(doc: DailyDoc): Record<string, unknown> {
  return { ...structuredClone(doc), built_at: Timestamp.fromDate(doc.built_at) };
}

export class FirestoreEventRepository implements EventRepository {
  constructor(
    private readonly db: Firestore,
    private readonly quota: QuotaMeter,
  ) {}

  private sessions() {
    return this.db.collection(COLLECTIONS.aSessions);
  }

  private hourly() {
    return this.db.collection(COLLECTIONS.aHourly);
  }

  /** Runs a Firestore call, reporting errors to the guard. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.quota.noteError(error);
      throw error;
    }
  }

  private record(kind: QuotaKind, n: number) {
    if (n > 0) this.quota.record(kind, n);
  }

  async readTrackingSettings(): Promise<TrackingSettings> {
    const snap = await this.call(() =>
      this.db.collection(COLLECTIONS.adminConfig).doc(ADMIN_CONFIG_DOCS.settings).get(),
    );
    this.record('reads', 1);
    const d = settingsDoc.parse(snap.data() ?? {});
    return {
      trackingEnabled: d.tracking_enabled ?? DEFAULT_TRACKING_SETTINGS.trackingEnabled,
      ipRetentionDays: d.ip_retention_days ?? DEFAULT_TRACKING_SETTINGS.ipRetentionDays,
      rawRetentionDays: d.raw_retention_days ?? DEFAULT_TRACKING_SETTINGS.rawRetentionDays,
    };
  }

  async getSession(id: string): Promise<SessionDoc | null> {
    const snap = await this.call(() => this.sessions().doc(id).get());
    this.record('reads', 1);
    return snap.exists ? parseSession(id, snap.data()) : null;
  }

  async writeSession(patch: SessionPatch, hourly?: HourlyIncrement | null): Promise<void> {
    const batch = this.db.batch();
    batch.set(this.sessions().doc(patch.id), sessionWrite(patch), { merge: true });
    if (hourly) batch.set(this.hourly().doc(hourly.hour), hourlyWrite(hourly.delta), { merge: true });
    await this.call(() => batch.commit());
    this.record('writes', hourly ? 2 : 1);
  }

  async listUnrolledSessions(seenBefore: Date, limit: number): Promise<SessionDoc[]> {
    const snap = await this.call(() =>
      this.sessions()
        .where('rolled_up', '==', false)
        .where('last_seen_at', '<', Timestamp.fromDate(seenBefore))
        .orderBy('last_seen_at')
        .limit(limit)
        .get(),
    );
    this.record('reads', Math.max(1, snap.size));
    return snap.docs.map((doc) => parseSession(doc.id, doc.data()));
  }

  async rollUpSession(id: string, hourly: HourlyIncrement): Promise<void> {
    const batch = this.db.batch();
    // update(), not set(): if retention deleted the session meanwhile, the batch fails instead of recreating it.
    batch.update(this.sessions().doc(id), { rolled_up: true });
    batch.set(this.hourly().doc(hourly.hour), hourlyWrite(hourly.delta), { merge: true });
    await this.call(() => batch.commit());
    this.record('writes', 2);
  }

  async getHourly(hours: string[]): Promise<(Rollup | null)[]> {
    if (hours.length === 0) return [];
    const snaps = await this.call(() => this.db.getAll(...hours.map((h) => this.hourly().doc(h))));
    this.record('reads', hours.length);
    return snaps.map((snap) => (snap.exists ? parseRollup(snap.data()) : null));
  }

  async putDaily(doc: DailyDoc): Promise<void> {
    await this.call(() => this.db.collection(COLLECTIONS.aDaily).doc(doc.day).set(dailyWrite(doc)));
    this.record('writes', 1);
  }

  async getDaily(day: string): Promise<DailyDoc | null> {
    const snap = await this.call(() => this.db.collection(COLLECTIONS.aDaily).doc(day).get());
    this.record('reads', 1);
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const builtAt = data.built_at instanceof Timestamp ? data.built_at.toDate() : new Date(0);
    return { ...parseRollup(data), day, built_at: builtAt };
  }

  async nullIps(seenBefore: Date, limit: number): Promise<number> {
    const snap = await this.call(() =>
      this.sessions()
        .where('ip_held', '==', true)
        .where('last_seen_at', '<', Timestamp.fromDate(seenBefore))
        .limit(limit)
        .select()
        .get(),
    );
    this.record('reads', Math.max(1, snap.size));
    if (snap.empty) return 0;
    const batch = this.db.batch();
    for (const doc of snap.docs) batch.update(doc.ref, { ip: null, ip_held: false });
    await this.call(() => batch.commit());
    this.record('writes', snap.size);
    return snap.size;
  }

  async deleteSessions(seenBefore: Date, limit: number): Promise<number> {
    return this.deleteMatching(
      this.sessions().where('last_seen_at', '<', Timestamp.fromDate(seenBefore)).limit(limit),
    );
  }

  async deleteHourly(beforeHour: string, limit: number): Promise<number> {
    return this.deleteMatching(this.hourly().where(FieldPath.documentId(), '<', beforeHour).limit(limit));
  }

  async deleteCounters(beforeDay: string, limit: number): Promise<number> {
    return this.deleteMatching(
      this.db.collection(COLLECTIONS.aCounters).where(FieldPath.documentId(), '<', beforeDay).limit(limit),
    );
  }

  private async deleteMatching(query: Query): Promise<number> {
    const snap = await this.call(() => query.select().get());
    this.record('reads', Math.max(1, snap.size));
    if (snap.empty) return 0;
    const batch = this.db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await this.call(() => batch.commit());
    this.record('deletes', snap.size);
    return snap.size;
  }

  async incrementCounters(day: string, group: string, delta: Record<string, number>): Promise<void> {
    const fields: Record<string, FieldValue> = {};
    for (const [name, n] of Object.entries(delta)) if (n !== 0) fields[name] = FieldValue.increment(n);
    if (Object.keys(fields).length === 0) return;
    await this.call(() =>
      this.db.collection(COLLECTIONS.aCounters).doc(day).set({ [group]: fields }, { merge: true }),
    );
    this.record('writes', 1);
  }

  async getCounters(day: string, group: string): Promise<Record<string, number>> {
    const snap = await this.call(() => this.db.collection(COLLECTIONS.aCounters).doc(day).get());
    this.record('reads', 1);
    const raw = snap.data()?.[group];
    const out: Record<string, number> = {};
    if (raw && typeof raw === 'object') {
      for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'number') out[name] = value;
      }
    }
    return out;
  }
}
