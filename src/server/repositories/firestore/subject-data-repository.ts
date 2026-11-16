import 'server-only';

import type { Firestore, Query } from 'firebase-admin/firestore';

import { COLLECTIONS } from '@/server/firestore/collections';
import { readsForAggregation, type QuotaMeter } from '@/server/quota/quota-guard';
import type { DataSubject, SubjectDataStore } from '@/server/services/data-deletion-service';

/**
 * One visitor's `a_sessions` docs, by `ip` (exact) or `user_id`. Both are
 * auto single-field indexes (03-data-model.md "Indexes": IP search, Settings
 * data deletion), the same equality the Sessions IP search already runs.
 * Pages and clicks are maps inside each doc, so deleting the doc removes them.
 *
 * Cost: countSessions = 1 read per 1,000 matches (min 1). deleteSessionsBatch
 * = 1 read per doc (min 1, `select()` reads no fields) + 1 delete per doc,
 * one batched commit. Whether a batch may run is the service's decision.
 */
export class FirestoreSubjectDataRepository implements SubjectDataStore {
  constructor(
    private readonly db: Firestore,
    private readonly quota: QuotaMeter,
  ) {}

  private query(subject: DataSubject): Query {
    const field = subject.kind === 'ip' ? 'ip' : 'user_id';
    return this.db.collection(COLLECTIONS.aSessions).where(field, '==', subject.value);
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.quota.noteError(error);
      throw error;
    }
  }

  async countSessions(subject: DataSubject): Promise<number> {
    const snap = await this.run(() => this.query(subject).count().get());
    const n = snap.data().count;
    this.quota.record('reads', readsForAggregation(n));
    return n;
  }

  async deleteSessionsBatch(subject: DataSubject, limit: number): Promise<number> {
    const snap = await this.run(() => this.query(subject).limit(Math.max(1, Math.floor(limit))).select().get());
    this.quota.record('reads', Math.max(1, snap.size));
    if (snap.empty) return 0;
    const batch = this.db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await this.run(() => batch.commit());
    this.quota.record('deletes', snap.size);
    return snap.size;
  }
}
