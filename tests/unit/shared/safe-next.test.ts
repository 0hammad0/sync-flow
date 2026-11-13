import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/shared/lib/safe-next';

// The admin sign-in redirect (phase 0.8) reuses this guard, so an open
// redirect here would become an open redirect into /admin.
describe('safeNextPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/admin/sessions?range=7d#top', '/admin/sessions?range=7d#top'],
  ])('keeps same-site path %s', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['https://evil.example'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['/a\u0000b'],
    ['/login'],
    ['/auth/callback'],
    ['/' + 'a'.repeat(600)],
  ])('rejects %j', (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });
});
