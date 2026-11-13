import 'server-only';

import { getBlocks } from '@/server/container';
import { compileBlocklist, EMPTY_BLOCKLIST, type CompiledBlocklist } from './matchers';
import type { BlocklistSnapshot } from './types';

/**
 * Where the cache loads from. FirestoreBlockRepository in production; it
 * reports every read and write to QuotaGuard (counted, never blocked).
 */
export interface BlocklistSource {
  /** One lazy load: `admin_config/blocklist` + `admin_config/settings`. */
  readBlocklist(): Promise<BlocklistSnapshot>;
  /** Adds approximate hit counts to `blocks/{id}.hits`. */
  addHits(hits: ReadonlyMap<string, number>): Promise<void>;
}

/** Cache age (T-4, kept at 60 s by T-27). */
export const BLOCKLIST_TTL_MS = 60_000;
/** After a failed load, wait this long before trying Firestore again. */
export const BLOCKLIST_RETRY_MS = 10_000;
/** Hit counters kept per instance before the oldest are dropped. */
const MAX_HIT_KEYS = 1_000;

export type BlocklistCacheOptions = {
  now?: () => number;
  ttlMs?: number;
  retryMs?: number;
  logger?: Pick<Console, 'warn'>;
};

/**
 * Per-instance blocklist cache. **Lazy** [T-27]: nothing is read until the
 * first `get()`, and only action requests call `get()`. Page views never do,
 * so an instance that serves only pages reads 0 docs.
 *
 * - Fresh for 60 s, then the next `get()` reloads (one load at a time).
 * - Fail open: on a load error it keeps serving the last good list (stale),
 *   or the empty list on a cold instance, and retries after 10 s.
 * - Hits are counted in memory and written on the next refresh, so a
 *   blocked request never waits for a write.
 */
export class BlocklistCache {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly retryMs: number;
  private readonly logger: Pick<Console, 'warn'>;

  private compiled: CompiledBlocklist | null = null;
  private settingsDoc: Record<string, unknown> | null = null;
  private nextLoadAt = Number.NEGATIVE_INFINITY;
  private loading: Promise<CompiledBlocklist> | null = null;
  private hits = new Map<string, number>();
  private loads = 0;

  constructor(
    /** Called on the first load only, so building the source (and the container) is lazy too. */
    private readonly getSource: () => BlocklistSource,
    options: BlocklistCacheOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? BLOCKLIST_TTL_MS;
    this.retryMs = options.retryMs ?? BLOCKLIST_RETRY_MS;
    this.logger = options.logger ?? console;
  }

  /** The current list. Reads Firestore only when the copy is missing or older than 60 s. Never throws. */
  get(): Promise<CompiledBlocklist> {
    if (this.compiled && this.now() < this.nextLoadAt) return Promise.resolve(this.compiled);
    if (!this.compiled && this.now() < this.nextLoadAt) return Promise.resolve(EMPTY_BLOCKLIST);
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  /** The raw `admin_config/settings` from the last good load (null before one). */
  settings(): Record<string, unknown> | null {
    return this.settingsDoc;
  }

  /** Counts one blocked request against a block. Written on the next refresh. */
  recordHit(blockId: string): void {
    if (!this.hits.has(blockId) && this.hits.size >= MAX_HIT_KEYS) return;
    this.hits.set(blockId, (this.hits.get(blockId) ?? 0) + 1);
  }

  /** Loads attempted on this instance (tests and the measurement script). */
  get loadCount(): number {
    return this.loads;
  }

  /** Forces the next get() to reload (tests, and after an admin write on this instance). */
  invalidate(): void {
    this.nextLoadAt = Number.NEGATIVE_INFINITY;
  }

  private async load(): Promise<CompiledBlocklist> {
    this.loads += 1;
    const hits = this.hits;
    this.hits = new Map();
    let source: BlocklistSource;
    try {
      source = this.getSource();
    } catch (error) {
      return this.fail(error);
    }

    const [read, flushed] = await Promise.allSettled([
      source.readBlocklist(),
      hits.size > 0 ? source.addHits(hits) : Promise.resolve(),
    ]);
    if (flushed.status === 'rejected') {
      // Hits are approximate ("≈"): a failed flush is dropped, not retried.
      this.logger.warn('[blocklist] hit counter flush failed', flushed.reason);
    }
    if (read.status === 'rejected') return this.fail(read.reason);

    this.compiled = compileBlocklist(read.value.blocklist);
    this.settingsDoc = read.value.settings;
    this.nextLoadAt = this.now() + this.ttlMs;
    return this.compiled;
  }

  private fail(error: unknown): CompiledBlocklist {
    this.nextLoadAt = this.now() + this.retryMs;
    this.logger.warn(
      this.compiled
        ? '[blocklist] load failed; serving the last good list'
        : '[blocklist] load failed on a cold instance; serving an empty list (fail open)',
      error,
    );
    return this.compiled ?? EMPTY_BLOCKLIST;
  }
}

let shared: BlocklistCache | null = null;

/**
 * The instance-wide cache used by the proxy, findBlock() and
 * assertNotBlocked(). The container (and its Firestore client) is only
 * built on the first load, i.e. on the first action request.
 */
export function getBlocklistCache(): BlocklistCache {
  shared ??= new BlocklistCache(() => getBlocks().repo);
  return shared;
}

/** Tests only: swap the shared cache. */
export function setBlocklistCacheForTests(cache: BlocklistCache | null): void {
  shared = cache;
}
