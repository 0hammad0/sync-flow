import { IngestService, type IngestDeps } from '@/features/tracking/server/ingest';
import type { RequestMeta } from '@/features/tracking/server/enrich';
import type { Beacon, TrackerEvent } from '@/features/tracking/schemas';
import type { QuotaDecision, QuotaKind, QuotaMeter } from '@/server/quota/quota-guard';

import { MemoryEventRepository } from './memory-event-repository';

/** QuotaMeter with a fixed decision per kind; records what was counted and asked. */
export class FakeQuota implements QuotaMeter {
  decisions: Record<QuotaKind, QuotaDecision> = { reads: 'ok', writes: 'ok', deletes: 'ok' };
  asked: QuotaKind[] = [];
  recorded: { kind: QuotaKind; count: number }[] = [];
  flushed = 0;
  record(kind: QuotaKind, count = 1) {
    this.recorded.push({ kind, count });
  }
  async canWrite(kind: QuotaKind) {
    this.asked.push(kind);
    return this.decisions[kind];
  }
  async assertCan(kind: QuotaKind) {
    return this.canWrite(kind);
  }
  noteError() {
    return false;
  }
  async flush() {
    this.flushed += 1;
  }
}

export const T0 = Date.parse('2026-11-13T10:15:00.000Z');
export const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

export function requestMeta(overrides: Partial<RequestMeta & { host: string | null }> = {}): RequestMeta & { host: string | null } {
  return {
    ip: '203.0.113.7',
    userAgent: UA_IPHONE,
    country: 'PK',
    region: 'PB',
    city: 'Lahore',
    lat: '31.5497',
    lon: '74.3436',
    tz: 'Asia/Karachi',
    sessionCookie: null,
    host: 'syncflow.example',
    ...overrides,
  };
}

export const SID_EVEN = `${'a'.repeat(31)}0`;
export const SID_ODD = `${'a'.repeat(31)}1`;

export function pv(id: string, path: string, t = T0, extra: Partial<TrackerEvent> = {}): TrackerEvent {
  return { type: 'pageview', t, pv: id, path, vw: 390, vh: 844, ...extra } as TrackerEvent;
}

export function engage(id: string, ms: number, scroll: 0 | 25 | 50 | 75 | 100 = 0, t = T0): TrackerEvent {
  return { type: 'engage', t, pv: id, ms, scroll };
}

export function beacon(events: TrackerEvent[], overrides: Partial<Beacon> = {}): Beacon {
  return { sid: SID_EVEN, seq: 0, final: false, did: null, events, invalid: 0, ...overrides };
}

export type Harness = {
  repo: MemoryEventRepository;
  quota: FakeQuota;
  service: IngestService;
  clock: { now: number };
  blocked: { value: boolean };
  logs: unknown[][];
};

export function ingestHarness(overrides: Partial<IngestDeps> = {}): Harness {
  const repo = new MemoryEventRepository();
  repo.settings = { trackingEnabled: true };
  const quota = new FakeQuota();
  const clock = { now: T0 };
  const blocked = { value: false };
  const logs: unknown[][] = [];
  const service = new IngestService({
    events: repo,
    quota,
    findBlock: async () => (blocked.value ? { blockId: 'b1', ref: 'ip:203.0.113.7' } : null),
    resolveUid: async (cookie) => (cookie === 'valid' ? 'uid-1' : null),
    hashDevice: (id) => `hash-${id}`,
    now: () => clock.now,
    logger: { warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a) },
    ...overrides,
  });
  return { repo, quota, service, clock, blocked, logs };
}
