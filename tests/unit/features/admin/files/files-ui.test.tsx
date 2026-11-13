import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import type { AdminFile } from '@/server/repositories/interfaces';
import { TooltipProvider } from '@/shared/ui/Tooltip';
import type { DeleteActions } from '@/features/admin/files/components/DeleteFilesDialog';
import type { FileRowDto } from '@/features/admin/files/types';

const actions = vi.hoisted(() => ({ deleteFile: vi.fn(), deleteFiles: vi.fn() }));
// The server page passes the actions down as props; these stand in for them.
const actionProps = actions as unknown as DeleteActions;
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn, updateTag: vi.fn() }));
vi.mock('@/server/container', () => ({ getContainer: () => ({}) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/files',
  useSearchParams: () => new URLSearchParams(),
}));
const signOut = vi.hoisted(() => ({ signOutAdmin: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/features/admin/auth/sign-out', () => signOut);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: FilesTable } = await import('@/features/admin/files/components/FilesTable');
const { default: FileDetail } = await import('@/features/admin/files/components/FileDetail');
const { default: DeleteFilesDialog } = await import('@/features/admin/files/components/DeleteFilesDialog');
const { toFileRowDto } = await import('@/features/admin/files/queries');

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const SECRET_NAME = 'ZEBRA-QUARTERLY-PAYROLL.pdf';
const ID = `f_${'A'.repeat(40)}`;

/** A stored file that (wrongly) still carries a name, as an old repository row would. */
function leakyFile(): AdminFile {
  return {
    id: ID,
    kind: 'share',
    name: SECRET_NAME,
    original_name: SECRET_NAME,
    mimeType: 'application/pdf',
    size: 2_516_582,
    createdAt: new Date('2026-11-13T10:00:00.000Z'),
    uploaderUid: null,
    senderName: null,
    roomCode: null,
    expiresAt: new Date('2026-11-20T12:00:00.000Z'),
    downloadCount: 3,
    maxDownloads: 10,
    isEncrypted: true,
    voiceDurationMs: null,
  } as AdminFile;
}

const row = (): FileRowDto => toFileRowDto(leakyFile(), { label: 'Guest', uid: null });

const Nuqs = withNuqsTestingAdapter();
function Providers({ children }: { children: ReactNode }) {
  return (
    <Nuqs>
      <TooltipProvider>{children}</TooltipProvider>
    </Nuqs>
  );
}

function renderTable(rows: FileRowDto[], canDelete: boolean) {
  return render(
    <FilesTable rows={rows} kind="all" expired={false} page={{ prevCursor: null, nextCursor: null }} canDelete={canDelete} actions={actionProps} now={NOW} />,
    { wrapper: Providers },
  );
}

describe('Files UI never shows a file name [D-6]', () => {
  it('the DTO drops a name the stored row still had', () => {
    expect(JSON.stringify(row())).not.toContain('ZEBRA');
  });

  it('the table row shows type, size and time, and no name', () => {
    const { container } = renderTable([row()], true);
    expect(container.textContent).not.toContain('ZEBRA');
    expect(container.innerHTML).not.toContain('ZEBRA');
    expect(screen.getAllByText('PDF').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2.5 MB').length).toBeGreaterThan(0);
    // The row link uses the opaque id only.
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain(`/admin/files/${ID}`);
  });

  it('the drawer detail shows no name, no link and no download', () => {
    const { container } = render(<FileDetail file={row()} now={NOW} />);
    expect(container.textContent).not.toContain('ZEBRA');
    expect(container.querySelectorAll('a, img, video, audio, iframe')).toHaveLength(0);
    expect(screen.getByText(/never shown/)).toBeTruthy();
    expect(screen.getByText('3 of 10')).toBeTruthy();
  });

  it('hides delete controls without files:delete', () => {
    renderTable([row()], false);
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Select/ })).toBeNull();
  });

  it('shows row actions and selection with files:delete', () => {
    renderTable([row()], true);
    expect(screen.getAllByRole('button', { name: /Actions for PDF, 2.5 MB, 2 h ago/ }).length).toBeGreaterThan(0);
  });
});

describe('DeleteFilesDialog', () => {
  it('asks to type DELETE above 10 files and sends opaque ids only', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `f_${String(i).padStart(30, 'B')}`);
    actions.deleteFiles.mockResolvedValue({ ok: true, data: { deleted: ids, missing: [], failed: [] } });
    const onDone = vi.fn();
    render(<DeleteFilesDialog open onOpenChange={vi.fn()} ids={ids} label="11 files" onDone={onDone} actions={actionProps} />);
    const confirm = screen.getByRole('button', { name: 'Delete 11 files' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'DELETE' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.deleteFiles).toHaveBeenCalledWith({ ids }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ deleted: ids, gone: [], failed: [] }));
  });

  it('explains step-up and offers a sign-in link when the sign-in is too old', async () => {
    actions.deleteFile.mockResolvedValue({ ok: false, error: 'step_up_required', authAgeSec: 4000 });
    render(<DeleteFilesDialog open onOpenChange={vi.fn()} ids={[ID]} label="PDF file (2.5 MB)" onDone={vi.fn()} actions={actionProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/last 15 minutes/));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out and sign in again' }));
    expect(signOut.signOutAdmin).toHaveBeenCalledTimes(1);
  });
});
