import { describe, expect, it } from 'vitest';
import { adminNextPath } from '@/features/admin/auth/admin-next';

describe('adminNextPath', () => {
  it('keeps admin paths with their query string', () => {
    expect(adminNextPath('/admin')).toBe('/admin');
    expect(adminNextPath('/admin/files?type=chat')).toBe('/admin/files?type=chat');
    expect(adminNextPath('/admin?range=7d')).toBe('/admin?range=7d');
  });

  it('falls back to /admin for anything else', () => {
    for (const raw of [
      null,
      undefined,
      '',
      '/dashboard',
      '/administrator',
      '//evil.example/admin',
      'https://evil.example/admin',
      '/\\evil.example',
      '/admin/sign-in',
      '/admin/sign-in?next=/admin',
      '/login?next=/admin',
    ]) {
      expect(adminNextPath(raw), String(raw)).toBe('/admin');
    }
  });
});
