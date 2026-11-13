import 'server-only';

import type { AdminContext } from '@/server/auth/types';
import type {
  AuditAction,
  AuditData,
  AuditListQuery,
  AuditPage,
  AuditRepository,
  NewAuditEntry,
} from '@/server/repositories/interfaces';

export type AuditTarget = { type: string; id: string };

/** Where the admin's request came from. Optional: not every caller has it. */
export type AuditRequestInfo = { ip?: string | null; userAgent?: string | null };

export type RecordAuditInput = {
  ctx: AdminContext;
  action: AuditAction;
  target?: AuditTarget | null;
  before?: AuditData | null;
  after?: AuditData | null;
  reason?: string | null;
  request?: AuditRequestInfo;
};

export type RecordDeniedInput = {
  uid: string | null;
  email: string | null;
  /** What was refused, e.g. `{ type: 'path', id: '/admin/files' }`. */
  target?: AuditTarget | null;
  /** Why, e.g. `no_role` or `missing_permission:files:delete`. */
  reason?: string | null;
  request?: AuditRequestInfo;
};

export type AuditServiceOptions = {
  now?: () => number;
  logger?: Pick<Console, 'error'>;
};

/** `before` / `after` are capped at this many bytes of JSON each. */
export const AUDIT_DATA_MAX_BYTES = 8 * 1024;
/** One `auth.denied` row per uid (or IP) per window, per server instance. */
export const DENIED_WINDOW_MS = 10 * 60_000;
const DENIED_KEYS_MAX = 1_000;
const MAX_DEPTH = 8;

/**
 * Keys whose last word is one of these are dropped, at any depth (hard rule 3:
 * never record message text, tokens, cookies or signed URLs). Matching the
 * last word keeps `contentType` but drops `messageText`, `signedUrl`, `idToken`.
 */
const DENIED_KEY_WORDS = new Set(['content', 'text', 'token', 'url', 'cookie', 'password', 'secret', 'body', 'message']);

function isDeniedKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const last = words.at(-1);
  if (!last) return false;
  return DENIED_KEY_WORDS.has(last) || (last.endsWith('s') && DENIED_KEY_WORDS.has(last.slice(0, -1)));
}

function cleanValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (depth >= MAX_DEPTH || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    return value.map((v) => cleanValue(v, depth + 1)).filter((v) => v !== undefined);
  }
  // Firestore Timestamp and similar: anything with toDate().
  const maybeDate = (value as { toDate?: unknown }).toDate;
  if (typeof maybeDate === 'function') return cleanValue(maybeDate.call(value), depth);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (isDeniedKey(k)) continue;
    const cleaned = cleanValue(v, depth + 1);
    if (cleaned !== undefined) out[k] = cleaned;
  }
  return out;
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/**
 * Makes `before` / `after` safe to store: drops deny-listed keys at any depth,
 * drops values Firestore or JSON cannot hold, turns dates into ISO strings,
 * and caps the result at 8 KB (keeps whole top-level keys in order, then sets
 * `_truncated: true`).
 */
export function sanitizeAuditData(data: AuditData | null | undefined): AuditData | null {
  if (!data) return null;
  const cleaned = cleanValue(data, 0) as AuditData;
  if (byteLength(cleaned) <= AUDIT_DATA_MAX_BYTES) return cleaned;

  const out: AuditData = { _truncated: true };
  for (const [k, v] of Object.entries(cleaned)) {
    out[k] = v;
    if (byteLength(out) > AUDIT_DATA_MAX_BYTES) delete out[k];
  }
  return out;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The sanitised row `record` would write. For services that write it inside their own transaction. */
export function buildAuditEntry(input: RecordAuditInput): NewAuditEntry {
  return {
    actorUid: input.ctx.uid,
    actorEmail: input.ctx.email,
    actorRole: input.ctx.role,
    action: input.action,
    targetType: input.target?.type ?? null,
    targetId: input.target?.id ?? null,
    before: sanitizeAuditData(input.before),
    after: sanitizeAuditData(input.after),
    reason: cleanText(input.reason),
    ip: cleanText(input.request?.ip),
    userAgent: cleanText(input.request?.userAgent),
  };
}

/**
 * Writes the audit log (hard rule 4). `record` throws when the write fails,
 * so the calling action fails too ("Action cancelled: could not write the
 * audit log"). Audit writes are never blocked by QuotaGuard, only counted.
 */
export class AuditService {
  private readonly now: () => number;
  private readonly logger: Pick<Console, 'error'>;
  private readonly lastDenied = new Map<string, number>();

  constructor(
    private readonly repo: AuditRepository,
    options: AuditServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? console;
  }

  /** Appends one row and returns its id. Throws if the write fails. */
  async record(input: RecordAuditInput): Promise<string> {
    return this.repo.append(buildAuditEntry(input));
  }

  /**
   * One page, newest first (Audit log screen). Read only. Scoping (a
   * moderator sees own rows only) is the caller's job, in the query it builds.
   */
  list(query: AuditListQuery): Promise<AuditPage> {
    return this.repo.list(query);
  }

  /**
   * Appends one row under `id` unless a row with that id exists (it is never
   * overwritten). Returns true when written, false when already there.
   * Throws if the write fails for any other reason.
   */
  async recordOnce(id: string, input: RecordAuditInput): Promise<boolean> {
    return this.repo.appendOnce(id, buildAuditEntry(input));
  }

  /**
   * Records `auth.denied` for a caller without the needed role. Rate limited
   * to one row per uid (or IP) per 10 min on this instance. Never throws: the
   * caller is already returning 401/403. Returns the row id, or null when
   * skipped or failed.
   */
  async recordDenied(input: RecordDeniedInput): Promise<string | null> {
    const key = input.uid ? `uid:${input.uid}` : `ip:${cleanText(input.request?.ip) ?? 'unknown'}`;
    const now = this.now();
    const last = this.lastDenied.get(key);
    if (last !== undefined && now - last < DENIED_WINDOW_MS) return null;
    this.rememberDenied(key, now);

    try {
      return await this.repo.append({
        actorUid: input.uid,
        actorEmail: input.email,
        actorRole: null,
        action: 'auth.denied',
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        before: null,
        after: null,
        reason: cleanText(input.reason),
        ip: cleanText(input.request?.ip),
        userAgent: cleanText(input.request?.userAgent),
      });
    } catch (error) {
      this.logger.error('[audit] could not write auth.denied', error);
      return null;
    }
  }

  private rememberDenied(key: string, now: number): void {
    if (this.lastDenied.size >= DENIED_KEYS_MAX) {
      for (const [k, at] of this.lastDenied) {
        if (now - at >= DENIED_WINDOW_MS) this.lastDenied.delete(k);
      }
      // Still full (a flood of distinct keys): forget the oldest half.
      if (this.lastDenied.size >= DENIED_KEYS_MAX) {
        const drop = Math.ceil(this.lastDenied.size / 2);
        for (const k of [...this.lastDenied.keys()].slice(0, drop)) this.lastDenied.delete(k);
      }
    }
    this.lastDenied.set(key, now);
  }
}
