'use server';

import { headers } from 'next/headers';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { ROLLUPS_TAG } from '@/features/admin/analytics/queries';
import { enforceAdminWriteLimit } from '@/server/auth/admin-write-limit';
import { requireAdmin } from '@/server/auth/require-admin';
import { requireRecentAuth } from '@/server/auth/step-up';
import { assertNotBlocked } from '@/server/blocklist/assert-not-blocked';
import { clientIp } from '@/server/blocklist/request';
import { getContainer, getSettingsParts } from '@/server/container';
import { toActionFailure, type ActionFailure, type ActionResult } from '@/server/errors';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import type { AuditRequestInfo } from '@/server/services/audit-service';
import { SETTINGS_TAG, subjectDeleteSchema, subjectPreviewSchema, updateSettingsSchema } from './schemas';
import type { SettingsSavedDto, SubjectDeleteDto, SubjectPreviewDto } from './types';

// Settings actions (15-settings.md "Actions"). Each one: requireAdmin
// ('settings:write', owner only) → block check (T-27) → write rate limit
// (5.4) → zod → service. The delete also needs a recent sign-in, like the
// other destructive admin actions (requireRecentAuth).
// D-5 = no: there is no TOTP step-up.

async function requestInfo(): Promise<AuditRequestInfo> {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get('user-agent') };
}

function invalid(error: z.ZodError): ActionFailure {
  return { ok: false, error: 'invalid', fields: z.flattenError(error).fieldErrors as Record<string, string[]> };
}

function failure(error: unknown): ActionFailure {
  if (error instanceof QuotaExceededError) {
    return { ok: false, error: 'conflict', message: "Today's Firestore budget is used up. Try again after 00:00 UTC." };
  }
  return toActionFailure(error);
}

/** Save tracking, consent and retention. Audit `settings.update` (changed fields, before / after). */
export async function updateSettings(input: unknown): Promise<ActionResult<SettingsSavedDto>> {
  try {
    const ctx = await requireAdmin('settings:write');
    const blocked = await assertNotBlocked();
    if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
    enforceAdminWriteLimit(ctx);
    const parsed = updateSettingsSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { expectedUpdatedAt, ...values } = parsed.data;
    const result = await getSettingsParts().settings.update(ctx, values, expectedUpdatedAt, { request: await requestInfo() });
    if (!result.ok) return failure(result.error);
    // This instance's admin caches at once; ingest and other instances within 60 s (their own caches).
    if (result.data.changed.length > 0) updateTag(SETTINGS_TAG);
    return { ok: true, data: result.data };
  } catch (e) {
    return failure(e);
  }
}

/** "Find data": count the sessions for an IP or uid, and whether today's delete budget covers them. No audit (read only). */
export async function previewSubjectData(input: unknown): Promise<ActionResult<SubjectPreviewDto>> {
  try {
    const ctx = await requireAdmin('settings:write');
    const blocked = await assertNotBlocked();
    if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
    enforceAdminWriteLimit(ctx);
    const parsed = subjectPreviewSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const preview = await getSettingsParts().deletion.preview(parsed.data.subject);
    return {
      ok: true,
      data: { subject: preview.subject, sessions: preview.sessions, deletesLeft: preview.budget.deletes, fits: preview.fits },
    };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Delete every `a_sessions` doc for an IP or uid (pages and clicks are inside
 * them). Typed confirm must equal the subject. Audit `data.delete` with
 * counts and a masked target. Rollups stay.
 */
export async function deleteSubjectData(input: unknown): Promise<ActionResult<SubjectDeleteDto>> {
  try {
    const ctx = await requireAdmin('settings:write');
    const blocked = await assertNotBlocked();
    if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
    enforceAdminWriteLimit(ctx);
    requireRecentAuth(ctx);
    const parsed = subjectDeleteSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const result = await getSettingsParts().deletion.deleteSubject(ctx, parsed.data.subject, { request: await requestInfo() });
    if (!result.ok) return failure(result.error);
    if (result.data.deleted > 0) {
      // Session lists and samples are cached under the rollups tag.
      updateTag(ROLLUPS_TAG);
      // Up to 500 deletes in one request: write them to the daily counter now.
      await getContainer().quota.flush();
    }
    return { ok: true, data: result.data };
  } catch (e) {
    return failure(e);
  }
}
