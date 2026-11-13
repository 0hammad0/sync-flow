import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  fileTypeOf,
  formatAgo,
  formatBytes,
  formatExactBytes,
  formatFileExpiry,
  formatVoiceDuration,
  usageTone,
} from '@/features/admin/files/format';
import {
  FILE_ID_RE,
  MAX_FILES_PER_DELETE,
  deleteFileSchema,
  deleteFilesSchema,
  filesParamsSchema,
} from '@/features/admin/files/schemas';
import { FILE_ID_PATTERN } from '@/server/files/file-id';
import { MAX_BULK_DELETE } from '@/server/services/file-service';
import { shareId } from '../../../../support/file-ids';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

describe('files format', () => {
  it('types files from the mime type only', () => {
    expect(fileTypeOf('application/pdf')).toBe('pdf');
    expect(fileTypeOf('image/svg+xml')).toBe('image');
    expect(fileTypeOf('video/mp4')).toBe('video');
    expect(fileTypeOf('audio/webm')).toBe('audio');
    expect(fileTypeOf('audio/webm', true)).toBe('voice');
    expect(fileTypeOf('application/zip')).toBe('archive');
    expect(fileTypeOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document');
    expect(fileTypeOf('text/plain; charset=utf-8')).toBe('document');
    expect(fileTypeOf('application/x-unknown')).toBe('other');
    expect(fileTypeOf('')).toBe('other');
  });

  it('formats sizes in decimal units, exact bytes in the tooltip', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2_516_582)).toBe('2.5 MB');
    expect(formatBytes(99_800_000)).toBe('99.8 MB');
    expect(formatBytes(6_210_000_000)).toBe('6.21 GB');
    expect(formatExactBytes(2_516_582)).toBe('2,516,582 bytes');
  });

  it('formats times relative to the server render', () => {
    expect(formatAgo('2026-11-13T10:00:00.000Z', NOW)).toBe('2 h ago');
    expect(formatAgo('2026-11-13T11:59:30.000Z', NOW)).toBe('just now');
    expect(formatFileExpiry(null, NOW)).toEqual({ text: 'Never', tone: 'none' });
    expect(formatFileExpiry('2026-11-20T12:00:00.000Z', NOW)).toEqual({ text: 'in 7 d', tone: 'none' });
    expect(formatFileExpiry('2026-11-13T15:00:00.000Z', NOW)).toEqual({ text: 'in 3 h', tone: 'soon' });
    expect(formatFileExpiry('2026-11-11T12:00:00.000Z', NOW)).toEqual({ text: 'Expired 2 d ago', tone: 'expired' });
    expect(formatVoiceDuration(42_400)).toBe('0:42');
  });

  it('colours the usage bar by share of the free tier', () => {
    expect(usageTone(0.62)).toBe('brand');
    expect(usageTone(0.7)).toBe('warning');
    expect(usageTone(0.95)).toBe('danger');
  });
});

describe('files schemas', () => {
  it('uses the same id pattern as the server codec, and the same bulk cap as the service', () => {
    expect(FILE_ID_RE.source).toBe(FILE_ID_PATTERN.source);
    expect(MAX_FILES_PER_DELETE).toBe(MAX_BULK_DELETE);
  });

  it('accepts opaque ids only', () => {
    expect(deleteFileSchema.safeParse({ id: shareId('abc') }).success).toBe(true);
    for (const id of ['s_9f1c2b3a4d5e6f708192a3b4c5d6e7f8', 'c_AB7KQ2MZ_x_0', '../etc', '']) {
      expect(deleteFileSchema.safeParse({ id }).success).toBe(false);
    }
  });

  it('caps bulk deletes at 100', () => {
    const id = shareId('abc');
    expect(deleteFilesSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(deleteFilesSchema.safeParse({ ids: Array(100).fill(id) }).success).toBe(true);
    expect(deleteFilesSchema.safeParse({ ids: Array(101).fill(id) }).success).toBe(false);
  });

  it('parses URL params with safe defaults and no search (D-6)', () => {
    expect(filesParamsSchema.parse({})).toEqual({ kind: 'all', expired: false });
    expect(filesParamsSchema.parse({ kind: 'chat', expired: '1', cursor: 'abc' })).toEqual({ kind: 'chat', expired: true, cursor: 'abc' });
    expect(filesParamsSchema.parse({ kind: 'nope', expired: 'yes', q: 'invoice' })).toEqual({ kind: 'all', expired: false });
  });
});

describe('admin code never reaches file content or names', () => {
  const ROOT = resolve(__dirname, '../../../../..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const adminFiles = [...walk(join(ROOT, 'src/features/admin')), ...walk(join(ROOT, 'src/app/admin'))];

  it('no admin route or component signs a download URL or claims a download [D-4]', () => {
    for (const file of adminFiles) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/signedDownloadUrl|claimDownload|getSignedUrl/);
    }
  });

  it('nothing on the Files screen reads a stored file name [D-6]', () => {
    // The audit read path names these keys only to drop them from old rows.
    const filesScreen = [...walk(join(ROOT, 'src/features/admin/files')), ...walk(join(ROOT, 'src/app/admin/(shell)/files'))];
    expect(filesScreen.length).toBeGreaterThan(5);
    for (const file of filesScreen) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/original_name|originalName\b/);
    }
  });
});
