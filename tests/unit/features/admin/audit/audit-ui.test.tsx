import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';

import AuditDiff from '@/features/admin/audit/components/AuditDiff';
import AuditTable from '@/features/admin/audit/components/AuditTable';
import type { AuditRowDto } from '@/features/admin/audit/types';
import { TooltipProvider } from '@/shared/ui/Tooltip';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/audit',
  useSearchParams: () => new URLSearchParams(),
}));

const Nuqs = withNuqsTestingAdapter();
function Providers({ children }: { children: ReactNode }) {
  return (
    <Nuqs>
      <TooltipProvider>{children}</TooltipProvider>
    </Nuqs>
  );
}

const rows: AuditRowDto[] = [
  {
    id: 'e1',
    at: '2026-11-13T14:02:31.000Z',
    actorUid: 'owner1',
    actorEmail: 'hammad@example.com',
    actorRole: 'owner',
    action: 'role.set',
    targetType: 'user',
    targetId: 'uid-ali',
    reason: 'Promoted',
    ip: '39.4.2.17',
    userAgent: 'Chrome macOS',
    before: { role: 'viewer', email: 'ali@example.com' },
    after: { role: 'moderator', email: 'ali@example.com' },
  },
  {
    id: 'e2',
    at: '2026-11-13T13:40:00.000Z',
    actorUid: 'mod1',
    actorEmail: 'ali@example.com',
    actorRole: 'moderator',
    action: 'file.delete',
    targetType: 'share_file',
    targetId: `f_${'C'.repeat(60)}`,
    reason: null,
    ip: null,
    userAgent: null,
    before: { kind: 'share', size: 10, mime: 'application/pdf' },
    after: null,
  },
];

function renderTable(canSearch = true) {
  return render(
    <AuditTable
      rows={rows}
      range="30d"
      action={null}
      actor={null}
      page={{ prevCursor: null, nextCursor: null }}
      canSearch={canSearch}
      canFilterActor={canSearch}
    />,
    { wrapper: Providers },
  );
}

describe('Audit log UI', () => {
  it('lists entries with action pills and has no edit or delete control anywhere', () => {
    renderTable();
    expect(screen.getAllByText('role.set').length).toBeGreaterThan(0);
    expect(screen.getAllByText('file.delete').length).toBeGreaterThan(0);
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names.some((n) => /\b(edit|delete entry|remove entry)\b/i.test(n))).toBe(false);
    expect(screen.queryByRole('checkbox', { name: /Select/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('shows the target search to the owner only', () => {
    const { unmount } = renderTable(true);
    expect(screen.getAllByPlaceholderText('Exact target id…').length).toBeGreaterThan(0);
    unmount();
    renderTable(false);
    expect(screen.queryByPlaceholderText('Exact target id…')).toBeNull();
  });

  it('opens a read-only detail sheet with the field diff', async () => {
    renderTable();
    fireEvent.click(screen.getAllByRole('button', { name: /13 Nov, 14:02, open details/ })[0]);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Changed role')).toBeTruthy();
    expect(within(sheet).getByText('viewer')).toBeTruthy();
    expect(within(sheet).getByText('moderator')).toBeTruthy();
    // Unchanged fields stay hidden until asked for.
    expect(within(sheet).queryByText('ali@example.com')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /delete|edit/i })).toBeNull();
  });
});

describe('AuditDiff', () => {
  it('hides unchanged fields until "Show all fields"', async () => {
    render(<AuditDiff before={{ a: 1, b: 2 }} after={{ a: 1, b: 3 }} />);
    expect(screen.queryByText('a')).toBeNull();
    expect(screen.getByText('b')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Show all fields/));
    await waitFor(() => expect(screen.getByText('a')).toBeTruthy());
  });

  it('says so when nothing was recorded', () => {
    render(<AuditDiff before={null} after={null} />);
    expect(screen.getByText('No recorded changes.')).toBeTruthy();
  });
});
