import type { ConsentModeChoice, DataSubject } from './constants';

// Client-safe DTOs for the Settings screen. No Firestore types, no raw docs.

export type SettingsValues = {
  trackingEnabled: boolean;
  consentMode: ConsentModeChoice;
  ipRetentionDays: number;
  rawRetentionDays: number;
};

export type SettingsDto = SettingsValues & {
  /** False: no `admin_config/settings` doc yet, the values are code defaults. */
  stored: boolean;
  /** `updated_at` in ms, sent back with a save as the conflict check. */
  updatedAt: number | null;
};

export type AdminRoleDto = {
  uid: string;
  email: string | null;
  role: 'owner' | 'moderator' | 'viewer' | null;
  disabled: boolean;
};

export type SettingsSavedDto = { changed: string[]; updatedAt: number | null };

export type SubjectPreviewDto = {
  subject: DataSubject;
  sessions: number;
  /** Deletes left today for this tool (cap minus used minus a small reserve). */
  deletesLeft: number;
  fits: boolean;
};

export type SubjectDeleteDto = {
  needed: number;
  deleted: number;
  complete: boolean;
  stopped: 'cap' | 'error' | null;
  errorId: string | null;
};

export type AddAdminDto = { uid: string; email: string | null; role: 'owner' | 'moderator' | 'viewer' };

/** Rebuild from claims: entries in the new index and what changed. */
export type RebuildAdminsDto = { admins: number; added: number; removed: number; changed: number };
