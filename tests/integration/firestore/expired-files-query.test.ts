import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { deleteIfExpiredIn, expiredFilesQuery } from '@/shared/lib/firebase/files';
import { clearEmulatorFirestore, emulatorAdminDb, hasFirestoreEmulator } from '../../support/firestore-emulator';

// The nightly cleanup's file query (phase 1 step 1.0): every file past its
// expiry, guest or owned; never a file with no expiry. Against the emulator,
// because `null` vs `<` and the index rules are Firestore's, not ours.
// Skips without FIRESTORE_EMULATOR_HOST (no Java locally); CI runs it.

const NOW = '2026-11-14T12:00:00.000Z';
const PAST = '2026-11-13T12:00:00.000Z';
const FUTURE = '2026-11-15T12:00:00.000Z';

describe.skipIf(!hasFirestoreEmulator)('Firestore emulator: expired files for the cleanup cron', { timeout: 30_000 }, () => {
  let emu: ReturnType<typeof emulatorAdminDb>;

  beforeAll(() => {
    emu = emulatorAdminDb('expired-files-query');
  });
  afterAll(async () => {
    await emu.close();
  });
  beforeEach(async () => {
    await clearEmulatorFirestore();
    const files = emu.db.collection('files');
    await Promise.all([
      files.doc('guest-expired').set({ token: 'guest-expired', owner_id: null, expires_at: PAST, file_path: 'guest-expired/a.pdf' }),
      files.doc('owned-expired').set({ token: 'owned-expired', owner_id: 'uid1', expires_at: PAST }),
      files.doc('owned-no-expiry').set({ token: 'owned-no-expiry', owner_id: 'uid1', expires_at: null }),
      files.doc('owned-later').set({ token: 'owned-later', owner_id: 'uid1', expires_at: FUTURE }),
      files.doc('guest-later').set({ token: 'guest-later', owner_id: null, expires_at: FUTURE }),
    ]);
  });

  it('lists guest and owned files past expiry, and never a file with no expiry', async () => {
    const snap = await expiredFilesQuery(emu.db.collection('files'), NOW, 100).get();
    expect(snap.docs.map((d) => d.id).sort()).toEqual(['guest-expired', 'owned-expired']);
  });

  it('respects the batch limit', async () => {
    const snap = await expiredFilesQuery(emu.db.collection('files'), NOW, 1).get();
    expect(snap.size).toBe(1);
  });

  it('deletes a still-expired record and returns its R2 key', async () => {
    const files = emu.db.collection('files');
    expect(await deleteIfExpiredIn(emu.db, files, 'guest-expired', NOW)).toBe('guest-expired/a.pdf');
    expect((await files.doc('guest-expired').get()).exists).toBe(false);
  });

  it('keeps a file the owner reshared after the cron listed it', async () => {
    const files = emu.db.collection('files');
    const listed = (await expiredFilesQuery(files, NOW, 100).get()).docs.map((d) => d.id);
    expect(listed).toContain('owned-expired');
    await files.doc('owned-expired').update({ expires_at: null });
    expect(await deleteIfExpiredIn(emu.db, files, 'owned-expired', NOW)).toBeNull();
    await files.doc('owned-later').update({ expires_at: FUTURE });
    expect(await deleteIfExpiredIn(emu.db, files, 'owned-later', NOW)).toBeNull();
    expect((await files.doc('owned-expired').get()).exists).toBe(true);
    expect((await files.doc('owned-later').get()).exists).toBe(true);
  });

  it('returns null for a record that is already gone', async () => {
    expect(await deleteIfExpiredIn(emu.db, emu.db.collection('files'), 'missing', NOW)).toBeNull();
  });
});
