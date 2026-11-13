import 'server-only';

import { checkRecentAuth } from '@/server/auth/step-up';
import type { AdminContext, AdminRole } from '@/server/auth/types';
import {
  err,
  NotFoundError,
  ok,
  ConflictError,
  ValidationError,
  type Result,
  type StepUpRequiredError,
} from '@/server/errors';
import type {
  BlockListQuery,
  BlockPage,
  BlockRecord,
  BlockRepository,
  BlockStatus,
  BlockType,
} from '@/server/repositories/interfaces';
import { buildAuditEntry, type AuditRequestInfo } from '@/server/services/audit-service';
import {
  blockExpiry,
  blockWarnings,
  isEmail,
  needsStepUp,
  normaliseBlockValue,
  REASON_MAX,
  REASON_MIN,
  selfBlockStop,
  type BlockDuration,
} from '@/shared/lib/block-values';
import { normaliseCidr, normaliseIp } from '@/shared/lib/ip';

/** Resolves a uid block's target (Firebase Auth). Only the uid and role are needed. */
export interface BlockUserLookup {
  /** By uid or email. null when there is no such user. */
  find(uidOrEmail: string): Promise<{ uid: string; role: AdminRole | null } | null>;
}

/** Where the acting admin is right now: for the self-block hard stops and the audit row. */
export type BlockActor = { ip: string | null; country: string | null; userAgent: string | null };

export type CreateBlockInput = {
  ctx: AdminContext;
  type: BlockType;
  /** As typed. Normalised here. */
  value: string;
  reason: string;
  duration: BlockDuration;
  /** "I understand" ticked for the warnings shown. */
  acknowledged: boolean;
  /** Type-to-confirm for country and wide-range blocks. */
  confirm?: string;
  actor: BlockActor;
};

export type RemoveBlockInput = { ctx: AdminContext; id: string; actor: BlockActor };

export type BlockServiceOptions = { now?: () => number };

export type BlockCounts = Record<BlockStatus, number>;

function requestInfo(actor: BlockActor): AuditRequestInfo {
  return { ip: actor.ip, userAgent: actor.userAgent };
}

function invalid(field: string, message: string): ValidationError {
  return new ValidationError({ [field]: [message] }, message);
}

const UTC_SHORT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/**
 * Block rules: validation, hard stops, warnings, step-up, audit. Storage is
 * the repository's job (one transaction per write). No React, no Firestore.
 */
export class BlockService {
  private readonly now: () => number;

  constructor(
    private readonly repo: BlockRepository,
    private readonly users: BlockUserLookup,
    options: BlockServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async create(input: CreateBlockInput): Promise<Result<BlockRecord, ValidationError | StepUpRequiredError>> {
    const { ctx, type, actor } = input;
    const normalised = normaliseBlockValue(type, input.value);
    if (!normalised.ok) return err(invalid('value', normalised.message));
    let value = normalised.value;

    const reason = input.reason.trim();
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
      return err(invalid('reason', 'Add a reason (at least 3 characters).'));
    }

    if (type === 'uid') {
      const user = await this.users.find(value);
      if (!user) return err(invalid('value', 'No user with that email or uid.'));
      if (user.role === 'owner' && user.uid !== ctx.uid) {
        return err(invalid('value', 'Owners cannot be blocked. Change their role first.'));
      }
      value = user.uid;
    }

    const stop = selfBlockStop(type, value, { uid: ctx.uid, ip: actor.ip, country: actor.country });
    if (stop) return err(invalid('value', stop));

    const warnings = blockWarnings(type, value);
    if (warnings.length > 0 && !input.acknowledged) {
      return err(invalid('acknowledged', warnings[0].message));
    }

    if (needsStepUp(type, value)) {
      const recent = checkRecentAuth(ctx, undefined, this.now());
      if (!recent.ok) return err(recent.error);
      if ((input.confirm ?? '').trim().toUpperCase() !== value.toUpperCase()) {
        return err(invalid('confirm', `Type ${value} to confirm.`));
      }
    }

    const nowMs = this.now();
    const now = new Date(nowMs);
    const result = await this.repo.create(
      {
        type,
        value,
        reason,
        createdBy: ctx.uid,
        createdByEmail: ctx.email,
        expiresAt: blockExpiry(input.duration, nowMs),
      },
      (stored) =>
        buildAuditEntry({
          ctx,
          action: 'block.create',
          target: { type: `block_${stored.type}`, id: stored.id },
          before: null,
          after: { type: stored.type, value: stored.value, expires_at: stored.expiresAt, reason: stored.reason },
          reason: stored.reason,
          request: requestInfo(actor),
        }),
      now,
    );
    if (!result.ok) {
      const until = result.existing.expiresAt;
      return err(
        invalid('value', until ? `This is already blocked until ${UTC_SHORT.format(until)} UTC.` : 'This is already blocked.'),
      );
    }
    return ok(result.block);
  }

  async remove(input: RemoveBlockInput): Promise<Result<BlockRecord, NotFoundError | ConflictError>> {
    const { ctx, actor } = input;
    const result = await this.repo.remove(
      input.id,
      ctx.uid,
      (before, after) =>
        buildAuditEntry({
          ctx,
          action: 'block.remove',
          target: { type: `block_${before.type}`, id: before.id },
          before: { type: before.type, value: before.value, expires_at: before.expiresAt, removed_at: null },
          after: { type: after.type, value: after.value, expires_at: after.expiresAt, removed_at: after.removedAt },
          reason: before.reason,
          request: requestInfo(actor),
        }),
      new Date(this.now()),
    );
    if (result.ok) return ok(result.block);
    // Second admin on the same row: no second audit row (edge case 7).
    if (result.reason === 'already_removed') return err(new ConflictError('Already unblocked.'));
    return err(new NotFoundError('block'));
  }

  /** One page. `q` is matched exactly after normalising (IP, range, country) or as a support ref. */
  list(query: Omit<BlockListQuery, 'now'>): Promise<BlockPage> {
    return this.repo.list({ ...query, q: normaliseQuery(query.q), now: new Date(this.now()) });
  }

  /** Tab counts (3 aggregation queries). */
  async counts(type?: BlockType): Promise<BlockCounts> {
    const now = new Date(this.now());
    const [active, expired, removed] = await Promise.all([
      this.repo.count('active', now, type),
      this.repo.count('expired', now, type),
      this.repo.count('removed', now, type),
    ]);
    return { active, expired, removed };
  }

  /** Cron: drop expired entries from the enforcement copy. Never throws. */
  async sweepExpired(): Promise<{ removed: number } | { error: string }> {
    try {
      return { removed: await this.repo.sweepExpired(new Date(this.now())) };
    } catch (error) {
      console.error('[blocks] expired-block sweep failed', error);
      return { error: 'sweep_failed' };
    }
  }
}

function normaliseQuery(q: string | undefined): string | undefined {
  const text = q?.trim();
  if (!text) return undefined;
  if (isEmail(text)) return text.toLowerCase();
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  return normaliseCidr(text) ?? normaliseIp(text) ?? (/^[0-9a-f]{32}$/i.test(text) ? text.toLowerCase() : text);
}
