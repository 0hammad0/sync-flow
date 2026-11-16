import { z } from 'zod';
import {
  CONSENT_MODE_CHOICES,
  IP_RETENTION,
  RAW_RETENTION,
  SETTINGS_MESSAGES as M,
  parseSubject,
  type DataSubject,
} from './constants';

// Server-side checks for the Settings actions (15-settings.md "Validation").
// The screen offers the same values; the server never trusts that.

export * from './constants';

const days = (bounds: { min: number; max: number }) =>
  z.number(M.outOfRange).int(M.outOfRange).min(bounds.min, M.outOfRange).max(bounds.max, M.outOfRange);

/**
 * updateSettings: all four fields, as the form holds them. `expectedUpdatedAt`
 * is the `updated_at` (ms) the form was loaded with, or null when there was
 * no saved doc: the save is refused if the stored doc moved since (two owners
 * saving at once, 15-settings.md edge case 5).
 */
export const updateSettingsSchema = z
  .object({
    trackingEnabled: z.boolean(M.outOfRange),
    consentMode: z.enum(CONSENT_MODE_CHOICES, M.outOfRange),
    ipRetentionDays: days(IP_RETENTION),
    rawRetentionDays: days(RAW_RETENTION),
    expectedUpdatedAt: z.number().int().nonnegative().nullable(),
  })
  .refine((v) => v.ipRetentionDays <= v.rawRetentionDays, { path: ['ipRetentionDays'], message: M.ipLongerThanRaw });
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;

/** An IP or a uid, parsed to its stored form. */
export const subjectSchema = z
  .string(M.subject)
  .max(200, M.subject)
  .transform((text, ctx): DataSubject => {
    const subject = parseSubject(text);
    if (!subject) {
      ctx.addIssue({ code: 'custom', message: M.subject });
      return z.NEVER;
    }
    return subject;
  });

/** previewSubjectData */
export const subjectPreviewSchema = z.object({ subject: subjectSchema });

/**
 * deleteSubjectData: `confirm` is what the owner typed. It must be the
 * subject exactly as the preview showed it (the normalised IP or the uid).
 */
export const subjectDeleteSchema = z
  .object({ subject: subjectSchema, confirm: z.string(M.confirm).trim().max(200, M.confirm) })
  .refine((v) => v.confirm === v.subject.value, { path: ['confirm'], message: M.confirm });
