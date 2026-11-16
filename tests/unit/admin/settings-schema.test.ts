import { describe, expect, it } from 'vitest';

import { CONSENT_MODES } from '@/server/analytics/model';
import {
  CONSENT_MODE_CHOICES,
  canExportSubject,
  maskSubject,
  parseSubject,
  subjectDeleteSchema,
  subjectExportSearch,
  subjectPreviewSchema,
  updateSettingsSchema,
} from '@/features/admin/settings/schemas';

// 15-settings.md "Data" (bounds) and "Validation & error messages".

const valid = { trackingEnabled: true, consentMode: 'eu_uk', ipRetentionDays: 30, rawRetentionDays: 90, expectedUpdatedAt: null };

function errorsOf(input: unknown): Record<string, string[] | undefined> {
  const r = updateSettingsSchema.safeParse(input);
  if (r.success) return {};
  const out: Record<string, string[]> = {};
  for (const issue of r.error.issues) (out[String(issue.path[0])] ??= []).push(issue.message);
  return out;
}

describe('updateSettingsSchema', () => {
  it('accepts the defaults and every listed option', () => {
    expect(updateSettingsSchema.safeParse(valid).success).toBe(true);
    for (const ip of [1, 7, 14, 30]) {
      for (const raw of [30, 60, 90]) {
        expect(updateSettingsSchema.safeParse({ ...valid, ipRetentionDays: ip, rawRetentionDays: raw }).success).toBe(true);
      }
    }
    expect(updateSettingsSchema.safeParse({ ...valid, ipRetentionDays: 7, rawRetentionDays: 7, expectedUpdatedAt: 1_763_000_000_000 }).success).toBe(true);
  });

  it.each([
    ['ipRetentionDays', 0],
    ['ipRetentionDays', 31],
    ['ipRetentionDays', 7.5],
    ['ipRetentionDays', '7'],
    ['rawRetentionDays', 6],
    ['rawRetentionDays', 91],
    ['rawRetentionDays', null],
  ])('%s = %j is out of range → "Pick a value from the list."', (field, value) => {
    expect(errorsOf({ ...valid, [field]: value })[field]).toContain('Pick a value from the list.');
  });

  it('IP kept longer than raw events is refused on the IP field', () => {
    expect(errorsOf({ ...valid, ipRetentionDays: 30, rawRetentionDays: 7 }).ipRetentionDays).toEqual([
      'Full IPs cannot be kept longer than raw events.',
    ]);
  });

  it('consent mode is one of none / eu_uk / all; tracking is a real boolean', () => {
    for (const mode of ['none', 'eu_uk', 'all']) expect(updateSettingsSchema.safeParse({ ...valid, consentMode: mode }).success).toBe(true);
    expect(errorsOf({ ...valid, consentMode: 'eu' }).consentMode).toBeDefined();
    expect(errorsOf({ ...valid, trackingEnabled: 'true' }).trackingEnabled).toBeDefined();
  });

  it('needs the loaded updated_at (number or null) for the conflict check', () => {
    expect(errorsOf({ ...valid, expectedUpdatedAt: undefined }).expectedUpdatedAt).toBeDefined();
    expect(errorsOf({ ...valid, expectedUpdatedAt: -1 }).expectedUpdatedAt).toBeDefined();
  });

  it('client choices match the server model', () => {
    expect([...CONSENT_MODE_CHOICES]).toEqual([...CONSENT_MODES]);
  });
});

describe('danger zone subject', () => {
  it('parses an IP (normalised) or a uid; anything else is refused', () => {
    expect(parseSubject(' 39.4.2.17 ')).toEqual({ kind: 'ip', value: '39.4.2.17' });
    expect(parseSubject('::ffff:39.4.2.17')).toEqual({ kind: 'ip', value: '39.4.2.17' });
    expect(parseSubject('2001:DB8::1')?.kind).toBe('ip');
    expect(parseSubject('uidVisitorBBBBBBBBBBBBBBBBBB')).toEqual({ kind: 'uid', value: 'uidVisitorBBBBBBBBBBBBBBBBBB' });
    for (const bad of ['', '39.4.2', '39.4.2.0/24', 'short', 'has space in it aaaaaaaaaaaa', 'a@b.com', null]) {
      expect(parseSubject(bad)).toBeNull();
    }
    expect(subjectPreviewSchema.safeParse({ subject: '39.4.2' }).error?.issues[0].message).toBe('Enter an IP address or a user id.');
  });

  it('delete needs the typed value to equal the subject exactly', () => {
    expect(subjectDeleteSchema.safeParse({ subject: '39.4.2.17', confirm: '39.4.2.17' }).success).toBe(true);
    expect(subjectDeleteSchema.safeParse({ subject: '39.4.2.17', confirm: ' 39.4.2.17 ' }).success).toBe(true);
    for (const confirm of ['39.4.2.1', '', 'DELETE', undefined]) {
      expect(subjectDeleteSchema.safeParse({ subject: '39.4.2.17', confirm }).success).toBe(false);
    }
    // The confirm is checked against the normalised subject the preview showed.
    expect(subjectDeleteSchema.safeParse({ subject: '::ffff:39.4.2.17', confirm: '39.4.2.17' }).success).toBe(true);
  });

  it('masks the audit target: IP keeps the /24, uid keeps 6 chars', () => {
    expect(maskSubject({ kind: 'ip', value: '39.4.2.17' })).toBe('39.4.2.•••');
    expect(maskSubject({ kind: 'uid', value: 'uidVisitorBBBBBBBBBBBBBBBBBB' })).toBe('uidVis•••');
  });

  it('offers the CSV export only where the sessions export matches the subject alone', () => {
    expect(canExportSubject({ kind: 'ip', value: '39.4.2.17' })).toBe(true);
    expect(canExportSubject({ kind: 'uid', value: 'a'.repeat(28) })).toBe(true);
    // Other uid lengths would not match the export's uid search and would export everyone.
    expect(canExportSubject({ kind: 'uid', value: 'a'.repeat(30) })).toBe(false);
    expect(subjectExportSearch({ kind: 'ip', value: '39.4.2.17' })).toBe('q=39.4.2.17&range=90d');
  });
});
