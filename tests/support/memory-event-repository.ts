import {
  DEFAULT_TRACKING_SETTINGS,
  addRollup,
  applySessionPatch,
  type DailyDoc,
  type Rollup,
  type SessionDoc,
  type SessionPatch,
  type TrackingSettings,
} from '@/server/analytics/model';
import { readsForAggregation } from '@/server/quota/quota-guard';
import type {
  EventRepository,
  HourlyIncrement,
  SessionListQuery,
  SessionPage,
  SessionRangeQuery,
} from '@/server/repositories/interfaces';

/**
 * In-memory EventRepository for unit tests. Same behaviour as the Firestore
 * one (the contract test runs on both). `writes` lists every write call, so
 * tests can assert "one write per flush" and "nothing written".
 */
export class MemoryEventRepository implements EventRepository {
  sessions = new Map<string, SessionDoc>();
  hourly = new Map<string, Rollup>();
  daily = new Map<string, DailyDoc>();
  counters = new Map<string, Record<string, Record<string, number>>>();
  /** `null` = no settings doc (code defaults). */
  settings: Partial<TrackingSettings> | null = null;
  /** One entry per write call, in order. */
  writes: { method: string; id: string }[] = [];
  reads = 0;
  deletes = 0;

  async readTrackingSettings(): Promise<TrackingSettings> {
    this.reads += 1;
    return { ...DEFAULT_TRACKING_SETTINGS, ...(this.settings ?? {}) };
  }

  async getSession(id: string): Promise<SessionDoc | null> {
    this.reads += 1;
    const doc = this.sessions.get(id);
    return doc ? structuredClone(doc) : null;
  }

  async writeSession(patch: SessionPatch, hourly?: HourlyIncrement | null): Promise<void> {
    this.writes.push({ method: 'writeSession', id: patch.id });
    this.sessions.set(patch.id, applySessionPatch(this.sessions.get(patch.id) ?? null, structuredClone(patch)));
    if (hourly) this.addHourly(hourly);
  }

  async listUnrolledSessions(seenBefore: Date, limit: number): Promise<SessionDoc[]> {
    const rows = [...this.sessions.values()]
      .filter((s) => s.rolled_up === false && s.last_seen_at.getTime() < seenBefore.getTime())
      .sort((a, b) => a.last_seen_at.getTime() - b.last_seen_at.getTime())
      .slice(0, limit);
    this.reads += Math.max(1, rows.length);
    return structuredClone(rows);
  }

  async rollUpSession(id: string, hourly: HourlyIncrement): Promise<void> {
    const doc = this.sessions.get(id);
    if (!doc) throw new Error(`No session ${id}`);
    this.writes.push({ method: 'rollUpSession', id });
    doc.rolled_up = true;
    this.addHourly(hourly);
  }

  async getHourly(hours: string[]): Promise<(Rollup | null)[]> {
    this.reads += hours.length;
    return hours.map((h) => {
      const doc = this.hourly.get(h);
      return doc ? structuredClone(doc) : null;
    });
  }

  async putDaily(doc: DailyDoc): Promise<void> {
    this.writes.push({ method: 'putDaily', id: doc.day });
    this.daily.set(doc.day, structuredClone(doc));
  }

  async getDaily(day: string): Promise<DailyDoc | null> {
    this.reads += 1;
    const doc = this.daily.get(day);
    return doc ? structuredClone(doc) : null;
  }

  async nullIps(seenBefore: Date, limit: number): Promise<number> {
    const rows = [...this.sessions.values()]
      .filter((s) => s.ip_held && s.last_seen_at.getTime() < seenBefore.getTime())
      .slice(0, limit);
    this.reads += Math.max(1, rows.length);
    for (const s of rows) {
      s.ip = null;
      s.ip_held = false;
      this.writes.push({ method: 'nullIp', id: s.id });
    }
    return rows.length;
  }

  async deleteSessions(seenBefore: Date, limit: number): Promise<number> {
    const ids = [...this.sessions.values()]
      .filter((s) => s.last_seen_at.getTime() < seenBefore.getTime())
      .slice(0, limit)
      .map((s) => s.id);
    return this.deleteIds(this.sessions, ids);
  }

  async deleteHourly(beforeHour: string, limit: number): Promise<number> {
    const ids = [...this.hourly.keys()].filter((k) => k < beforeHour).sort().slice(0, limit);
    return this.deleteIds(this.hourly, ids);
  }

  async deleteCounters(beforeDay: string, limit: number): Promise<number> {
    const ids = [...this.counters.keys()].filter((k) => k < beforeDay).sort().slice(0, limit);
    return this.deleteIds(this.counters, ids);
  }

  async incrementCounters(day: string, group: string, delta: Record<string, number>): Promise<void> {
    const entries = Object.entries(delta).filter(([, n]) => n !== 0);
    if (entries.length === 0) return;
    this.writes.push({ method: 'incrementCounters', id: day });
    const doc = this.counters.get(day) ?? {};
    const g = (doc[group] ??= {});
    for (const [name, n] of entries) g[name] = (g[name] ?? 0) + n;
    this.counters.set(day, doc);
  }

  async getCounters(day: string, group: string): Promise<Record<string, number>> {
    this.reads += 1;
    return { ...(this.counters.get(day)?.[group] ?? {}) };
  }

  // ----- EventReader (admin screens) -----

  async readDaily(days: string[]): Promise<(DailyDoc | null)[]> {
    return Promise.all(days.map((d) => this.getDaily(d)));
  }

  async readHourly(hours: string[]): Promise<(Rollup | null)[]> {
    return this.getHourly(hours);
  }

  private inRange(query: SessionRangeQuery): SessionDoc[] {
    const from = query.from.getTime();
    const to = query.to.getTime();
    return [...this.sessions.values()].filter((s) => {
      const t = s.started_at?.getTime();
      if (t === undefined || t < from || t >= to) return false;
      if (!query.filter) return true;
      const { field, value } = query.filter;
      return s[field] === value;
    });
  }

  private newestFirst(rows: SessionDoc[]): SessionDoc[] {
    return rows.sort(
      (a, b) => (b.started_at?.getTime() ?? 0) - (a.started_at?.getTime() ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
  }

  private returned(rows: SessionDoc[]): SessionDoc[] {
    this.reads += Math.max(1, rows.length);
    return structuredClone(rows);
  }

  async listSessions(query: SessionListQuery): Promise<SessionPage> {
    const limit = Math.min(Math.max(Math.floor(query.limit) || 1, 1), 100);
    let rows = this.newestFirst(this.inRange(query));
    const cursor = query.cursor ? /^(\d+)\.(.+)$/.exec(Buffer.from(query.cursor, 'base64url').toString()) : null;
    if (cursor) {
      const ms = Number(cursor[1]);
      const id = cursor[2];
      rows = rows.filter((s) => {
        const t = s.started_at?.getTime() ?? 0;
        return t < ms || (t === ms && s.id < id);
      });
    }
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      page.length === limit && last?.started_at
        ? Buffer.from(`${last.started_at.getTime()}.${last.id}`).toString('base64url')
        : null;
    return { sessions: this.returned(page), nextCursor };
  }

  async countSessions(query: SessionRangeQuery): Promise<number> {
    const n = this.inRange(query).length;
    this.reads += readsForAggregation(n);
    return n;
  }

  async findSessionsByIp(ip: string, limit: number): Promise<SessionDoc[]> {
    return this.returned([...this.sessions.values()].filter((s) => s.ip === ip).slice(0, Math.max(1, limit)));
  }

  async listNewestSessions(query: { from: Date; to: Date; limit: number }): Promise<SessionDoc[]> {
    return this.returned(this.newestFirst(this.inRange(query)).slice(0, Math.max(1, query.limit)));
  }

  private activeSince(since: Date): SessionDoc[] {
    return [...this.sessions.values()]
      .filter((s) => s.last_seen_at.getTime() > since.getTime())
      .sort((a, b) => b.last_seen_at.getTime() - a.last_seen_at.getTime());
  }

  async countActiveSessions(since: Date): Promise<number> {
    const n = this.activeSince(since).length;
    this.reads += readsForAggregation(n);
    return n;
  }

  async listActiveSessions(since: Date, limit: number): Promise<SessionDoc[]> {
    return this.returned(this.activeSince(since).slice(0, Math.max(1, limit)));
  }

  /** Session writes only (writeSession calls), for "one write per flush" checks. */
  sessionWrites(): number {
    return this.writes.filter((w) => w.method === 'writeSession').length;
  }

  private addHourly({ hour, delta }: HourlyIncrement): void {
    const current = this.hourly.get(hour);
    this.hourly.set(hour, current ? addRollup(current, delta) : structuredClone(delta));
  }

  private deleteIds<V>(map: Map<string, V>, ids: string[]): number {
    this.reads += Math.max(1, ids.length);
    for (const id of ids) map.delete(id);
    this.deletes += ids.length;
    return ids.length;
  }
}
