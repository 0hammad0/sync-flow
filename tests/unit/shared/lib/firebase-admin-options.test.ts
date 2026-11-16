import { beforeEach, describe, expect, it, vi } from 'vitest';

const certMock = vi.hoisted(() => vi.fn((sa: unknown) => ({ kind: 'cert', sa })));
vi.mock('firebase-admin/app', () => ({ cert: certMock, initializeApp: vi.fn(), getApps: vi.fn(() => []) }));

import { EMULATOR_PROJECT_ID, adminAppOptions } from '@/shared/lib/firebase/admin';

const LIVE = {
  FIREBASE_PROJECT_ID: 'live-project',
  FIREBASE_CLIENT_EMAIL: 'sa@live-project.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
};
const EMULATORS = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' };
const MISSING = /Missing Firebase Admin credentials/;

beforeEach(() => certMock.mockClear());

describe('adminAppOptions: emulator', () => {
  it('starts with no cert on project demo-syncflow when both emulator hosts are set', () => {
    expect(adminAppOptions({ ...EMULATORS })).toEqual({ projectId: 'demo-syncflow' });
    expect(EMULATOR_PROJECT_ID).toBe('demo-syncflow');
    expect(certMock).not.toHaveBeenCalled();
  });

  it('ignores live credentials and a live project id on the emulator', () => {
    expect(adminAppOptions({ ...LIVE, ...EMULATORS })).toEqual({ projectId: 'demo-syncflow' });
    expect(certMock).not.toHaveBeenCalled();
  });

  it('refuses the Firestore emulator without the Auth emulator (no live Auth calls)', () => {
    expect(() => adminAppOptions({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
    expect(() => adminAppOptions({ ...LIVE, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
  });
});

describe('adminAppOptions: production (no FIRESTORE_EMULATOR_HOST)', () => {
  it('throws with no credentials', () => {
    expect(() => adminAppOptions({})).toThrow(MISSING);
  });

  it.each(['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'] as const)('throws when %s is missing', (key) => {
    const env: Record<string, string> = { ...LIVE };
    delete env[key];
    expect(() => adminAppOptions(env)).toThrow(MISSING);
  });

  it('the Auth emulator alone does not lift the credential check', () => {
    expect(() => adminAppOptions({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(MISSING);
  });

  it('an empty FIRESTORE_EMULATOR_HOST is not emulator mode', () => {
    expect(() => adminAppOptions({ FIRESTORE_EMULATOR_HOST: '', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(MISSING);
  });

  it('uses the service-account cert, with escaped newlines in the key restored', () => {
    const options = adminAppOptions({ ...LIVE });
    expect(certMock).toHaveBeenCalledWith({
      projectId: 'live-project',
      clientEmail: LIVE.FIREBASE_CLIENT_EMAIL,
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    });
    expect(options).toEqual({ credential: { kind: 'cert', sa: expect.objectContaining({ projectId: 'live-project' }) } });
    expect(options).not.toHaveProperty('projectId');
  });
});
