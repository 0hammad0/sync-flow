import { DEFAULT_TRACKING_SETTINGS } from '@/server/analytics/model';
import type { QuotaCounts, QuotaSnapshot } from '@/server/quota/quota-guard';
import type { NewAuditEntry } from '@/server/repositories/interfaces';
import type { DataSubject, QuotaBudget, SubjectDataStore } from '@/server/services/data-deletion-service';
import type {
  AdminSettings,
  SettingsStore,
  SettingsWrite,
  SettingsWriteOutcome,
  StoredSettings,
} from '@/server/services/settings-service';

/** In-memory `admin_config/settings` with the same transaction rules as the Firestore store. */
export class MemorySettingsStore implements SettingsStore {
  doc: { values: AdminSettings; updatedAt: Date | null; updatedBy: string | null; quota?: Record<string, number> } | null = null;
  /** Audit rows written in the same "transaction" as the settings. */
  audit: NewAuditEntry[] = [];
  reads = 0;
  writes = 0;

  async read(): Promise<StoredSettings> {
    this.reads += 1;
    return this.snapshot();
  }

  async write(input: SettingsWrite): Promise<SettingsWriteOutcome> {
    this.reads += 1;
    const before = this.snapshot();
    if ((before.updatedAt?.getTime() ?? null) !== input.expectedUpdatedAt) return 'conflict';
    const entry = input.audit(before);
    if (!entry) return 'unchanged';
    this.doc = { ...(this.doc ?? {}), values: { ...input.values }, updatedAt: input.now, updatedBy: input.actorUid };
    this.audit.push(structuredClone(entry));
    this.writes += 2;
    return 'saved';
  }

  private snapshot(): StoredSettings {
    return {
      values: { ...DEFAULT_TRACKING_SETTINGS, ...(this.doc?.values ?? {}) },
      exists: this.doc !== null,
      updatedAt: this.doc?.updatedAt ?? null,
      updatedBy: this.doc?.updatedBy ?? null,
    };
  }
}

export type MemorySession = { id: string; ip: string | null; user_id: string | null };

/**
 * In-memory `a_sessions` for the subject delete, billing like Firestore:
 * count = 1 read per 1,000 (min 1), batch = 1 read per doc (min 1) + 1
 * delete per doc. Every cost also goes to the shared FakeQuota.
 */
export class MemorySubjectStore implements SubjectDataStore {
  sessions: MemorySession[] = [];
  batches: number[] = [];
  /** Throw on the nth batch call (1-based), to test a mid-run failure. */
  failOnBatch: number | null = null;

  constructor(private readonly quota: FakeQuota) {}

  private matches(subject: DataSubject) {
    return this.sessions.filter((s) => (subject.kind === 'ip' ? s.ip === subject.value : s.user_id === subject.value));
  }

  async countSessions(subject: DataSubject): Promise<number> {
    const n = this.matches(subject).length;
    this.quota.spend('reads', Math.max(1, Math.ceil(n / 1000)));
    return n;
  }

  async deleteSessionsBatch(subject: DataSubject, limit: number): Promise<number> {
    this.batches.push(limit);
    if (this.failOnBatch !== null && this.batches.length === this.failOnBatch) {
      throw Object.assign(new Error('deadline exceeded for a_sessions/abc 203.0.113.9'), { code: 4 });
    }
    const docs = this.matches(subject).slice(0, limit);
    this.quota.spend('reads', Math.max(1, docs.length));
    const ids = new Set(docs.map((d) => d.id));
    this.sessions = this.sessions.filter((s) => !ids.has(s.id));
    this.quota.spend('deletes', docs.length);
    return docs.length;
  }
}

/** QuotaGuard's `usage()` over plain counters. `onUsage` lets a test spend from "another instance". */
export class FakeQuota implements QuotaBudget {
  used: QuotaCounts = { reads: 0, writes: 0, deletes: 0 };
  caps: QuotaCounts = { reads: 10_000, writes: 5_000, deletes: 5_000 };
  stoppedUntil: number | null = null;
  onUsage: (() => void) | null = null;

  spend(kind: keyof QuotaCounts, n: number) {
    this.used[kind] += n;
  }

  async usage(): Promise<QuotaSnapshot> {
    this.onUsage?.();
    return { day: '2026-11-16', used: { ...this.used }, caps: { ...this.caps }, stoppedUntil: this.stoppedUntil };
  }
}
