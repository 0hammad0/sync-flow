import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UserDetail from '@/features/admin/users/components/UserDetail';
import type { UserDetailDto } from '@/features/admin/users/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/users/x',
  useSearchParams: () => new URLSearchParams(),
}));
// The actions file is 'use server'; the component only needs the names.
vi.mock('@/features/admin/users/actions', () => ({
  disableUser: vi.fn(),
  enableUser: vi.fn(),
  revokeUserSessions: vi.fn(),
  setUserRole: vi.fn(),
}));

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const user: UserDetailDto = {
  uid: 'uidTargetBBBBBBBBBBBBBBBBBBB',
  email: 'sara@example.com',
  role: null,
  disabled: false,
  createdAt: '2026-09-02T00:00:00.000Z',
  lastSignInAt: '2026-11-13T09:01:00.000Z',
  lastSeenAt: '2026-11-13T10:00:00.000Z',
  lastRefreshAt: '2026-11-13T10:00:00.000Z',
  fileCount: 14,
  fileBytes: 432_640_000,
};
const all = { disable: true, revoke: true, roles: true };
const none = { disable: false, revoke: false, roles: false };

describe('UserDetail', () => {
  it('owner on someone else: shows files count and storage, and every action', () => {
    render(<UserDetail user={user} isSelf={false} can={all} adminEmail="o@example.com" nowMs={NOW} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('sara@example.com');
    expect(screen.getByText('14')).toBeTruthy();
    expect(screen.getByText('412.6 MB')).toBeTruthy();
    expect(screen.getByText('2 h ago')).toBeTruthy();
    for (const name of ['Disable', 'Sign out everywhere', 'Set role']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('your own account: no actions, a note instead', () => {
    render(<UserDetail user={{ ...user, role: 'owner' }} isSelf can={all} adminEmail="o@example.com" nowMs={NOW} />);
    expect(screen.getByText(/This is you/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('viewer: no action buttons', () => {
    render(<UserDetail user={user} isSelf={false} can={none} adminEmail="v@example.com" nowMs={NOW} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a disabled user shows the Disabled badge as text and offers Enable', () => {
    render(<UserDetail user={{ ...user, disabled: true }} isSelf={false} can={all} adminEmail="o@example.com" nowMs={NOW} />);
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy();
  });
});
