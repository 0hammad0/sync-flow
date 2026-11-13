import 'server-only';

import { z } from 'zod';

import type { BucketTotals, StorageRemover, StorageStats } from '@/server/repositories/interfaces';
import { R2_BUCKET, deleteObject, prefixUsage } from '@/shared/lib/r2';

export const CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
/** The GraphQL dataset is sampled about hourly [U: measure the lag]; look back a day for the latest sample. */
const LOOKBACK_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 10_000;

// Cloudflare docs: "Querying R2 storage metrics" (r2StorageAdaptiveGroups, max of the latest sample).
const QUERY = `query R2Storage($accountTag: string!, $bucket: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2StorageAdaptiveGroups(
        limit: 1
        filter: { datetime_geq: $start, datetime_leq: $end, bucketName: $bucket }
        orderBy: [datetime_DESC]
      ) {
        max { objectCount payloadSize }
        dimensions { datetime }
      }
    }
  }
}`;

const responseSchema = z.object({
  data: z
    .object({
      viewer: z.object({
        accounts: z.array(
          z.object({
            r2StorageAdaptiveGroups: z.array(
              z.object({
                max: z.object({ objectCount: z.number(), payloadSize: z.number() }),
                dimensions: z.object({ datetime: z.string() }),
              }),
            ),
          }),
        ),
      }),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type R2StorageDeps = {
  accountId?: string;
  apiToken?: string;
  bucket?: string;
  fetch?: typeof fetch;
  deleteObject?: (key: string) => Promise<void>;
  prefixUsage?: (prefix: string) => Promise<{ objects: number; bytes: number }>;
};

/**
 * R2 object deletes and bucket totals. Totals come from the Cloudflare
 * GraphQL Analytics API, which needs CF_ACCOUNT_ID and CF_API_TOKEN (an
 * "Account Analytics: Read" token). No Firestore calls here.
 * D-4: nothing here reads an object's bytes or signs a URL.
 */
export class R2StorageRepository implements StorageStats, StorageRemover {
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly bucket: string;
  private readonly fetchFn: typeof fetch;
  private readonly remove: (key: string) => Promise<void>;
  private readonly usage: (prefix: string) => Promise<{ objects: number; bytes: number }>;

  constructor(deps: R2StorageDeps = {}) {
    this.accountId = deps.accountId ?? process.env.CF_ACCOUNT_ID ?? '';
    this.apiToken = deps.apiToken ?? process.env.CF_API_TOKEN ?? '';
    this.bucket = deps.bucket ?? R2_BUCKET;
    this.fetchFn = deps.fetch ?? fetch;
    this.remove = deps.deleteObject ?? deleteObject;
    this.usage = deps.prefixUsage ?? prefixUsage;
  }

  async deleteObject(key: string): Promise<void> {
    if (!key) throw new Error('deleteObject: empty key');
    await this.remove(key);
  }

  prefixUsage(prefix: string): Promise<{ objects: number; bytes: number }> {
    return this.usage(prefix);
  }

  async bucketTotals(now = new Date()): Promise<BucketTotals | null> {
    if (!this.accountId || !this.apiToken) return null;
    const res = await this.fetchFn(CF_GRAPHQL_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          accountTag: this.accountId,
          bucket: this.bucket,
          start: new Date(now.getTime() - LOOKBACK_MS).toISOString(),
          end: now.toISOString(),
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Cloudflare GraphQL answered ${res.status}`);
    const body = responseSchema.parse(await res.json());
    if (body.errors?.length) throw new Error(`Cloudflare GraphQL error: ${body.errors[0].message}`);
    const sample = body.data?.viewer.accounts[0]?.r2StorageAdaptiveGroups[0];
    // No sample in the window: an empty (or brand new) bucket.
    if (!sample) return { objectCount: 0, payloadBytes: 0, measuredAt: now };
    return {
      objectCount: sample.max.objectCount,
      payloadBytes: sample.max.payloadSize,
      measuredAt: new Date(sample.dimensions.datetime),
    };
  }
}
