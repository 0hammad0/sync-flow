import 'server-only';

import type { AdminContext } from '@/server/auth/types';
import { NotFoundError, ValidationError, err, ok, type Result } from '@/server/errors';
import type {
  AdminFile,
  BucketTotals,
  FileListQuery,
  FilePage,
  FileReader,
  FileRemover,
  StorageRemover,
  StorageStats,
  StoredBytes,
} from '@/server/repositories/interfaces';
import type { AuditRequestInfo, AuditService } from '@/server/services/audit-service';

/** Bulk delete cap (09-files-and-storage.md "Delete many (≤ 100)"). */
export const MAX_BULK_DELETE = 100;

export type DeleteFileOptions = { reason?: string | null; request?: AuditRequestInfo; batchId?: string };

export type BulkDeleteResult = { deleted: string[]; missing: string[]; failed: string[] };

export type FileServiceDeps = {
  reader: FileReader;
  remover: FileRemover;
  storage: StorageRemover & StorageStats;
  audit: Pick<AuditService, 'record'>;
  now?: () => Date;
  logger?: Pick<Console, 'error'>;
};

/**
 * What the audit row keeps about a file: metadata only. Never the file name
 * (D-6, overrides the spec's "before = name, …"), content or keys [D-4].
 * The target id is the opaque file id, never a share token.
 */
export function fileAuditBefore(file: AdminFile) {
  return {
    kind: file.kind,
    size: file.size,
    mime: file.mimeType,
    owner: file.uploaderUid,
    room: file.roomCode,
  };
}

/**
 * Files and storage (docs/admin/03-features/09-files-and-storage.md).
 * Permission checks (`files:read`, `files:delete` + step-up) happen in the
 * actions before these methods run.
 */
export class FileService {
  private readonly now: () => Date;
  private readonly logger: Pick<Console, 'error'>;

  constructor(private readonly deps: FileServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? console;
  }

  list(query: FileListQuery): Promise<FilePage> {
    return this.deps.reader.list(query, this.now());
  }

  get(id: string): Promise<AdminFile | null> {
    return this.deps.reader.get(id);
  }

  bucketTotals(): Promise<BucketTotals | null> {
    return this.deps.storage.bucketTotals();
  }

  /** R2 objects and bytes under one prefix (Class A list calls, no Firestore). */
  prefixUsage(prefix: string): Promise<{ objects: number; bytes: number }> {
    return this.deps.storage.prefixUsage(prefix);
  }

  shareTotals(): Promise<StoredBytes> {
    return this.deps.reader.shareTotals();
  }

  ownerTotals(uid: string): Promise<StoredBytes> {
    return this.deps.reader.ownerTotals(uid);
  }

  expiredOwnedTotals(): Promise<StoredBytes> {
    return this.deps.reader.expiredOwnedTotals(this.now());
  }

  /**
   * R2 object first, then the record (same order as the cleanup cron), then
   * the `file.delete` audit row. If R2 fails, nothing changed and the error
   * is thrown. A retry after a later failure is safe: a missing object is OK.
   */
  async deleteFile(ctx: AdminContext, id: string, opts: DeleteFileOptions = {}): Promise<Result<{ id: string }>> {
    const file = await this.deps.reader.get(id);
    if (!file) return err(new NotFoundError('file'));
    const key = await this.deps.remover.storageKeyOf(id);
    if (!key) return err(new NotFoundError('file'));

    await this.deps.storage.deleteObject(key);
    const removed = await this.deps.remover.removeRecord(id, this.now());
    if (!removed) return err(new NotFoundError('file'));

    await this.deps.audit.record({
      ctx,
      action: 'file.delete',
      target: { type: file.kind === 'share' ? 'share_file' : 'chat_attachment', id },
      before: fileAuditBefore(file),
      after: opts.batchId ? { batchId: opts.batchId } : null,
      reason: opts.reason ?? null,
      request: opts.request,
    });
    return ok({ id });
  }

  /** One `file.delete` row per file, sharing `after.batchId`. Partial results, never all-or-nothing. */
  async deleteFiles(
    ctx: AdminContext,
    ids: readonly string[],
    opts: Omit<DeleteFileOptions, 'batchId'> = {},
  ): Promise<Result<BulkDeleteResult>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0 || unique.length > MAX_BULK_DELETE) {
      return err(new ValidationError({ ids: [`Select between 1 and ${MAX_BULK_DELETE} files.`] }));
    }
    const batchId = crypto.randomUUID();
    const result: BulkDeleteResult = { deleted: [], missing: [], failed: [] };
    for (const id of unique) {
      try {
        const one = await this.deleteFile(ctx, id, { ...opts, batchId });
        if (one.ok) result.deleted.push(id);
        else result.missing.push(id);
      } catch (error) {
        // The opaque id and the error kind only: an R2 or Firestore message can
        // hold the object key (`{token}/{name}`) or a doc path with the token.
        const code = (error as { code?: unknown; name?: unknown } | null) ?? {};
        this.logger.error(`[files] delete failed for ${id}`, String(code.name ?? 'Error'), String(code.code ?? ''));
        result.failed.push(id);
      }
    }
    return ok(result);
  }
}
