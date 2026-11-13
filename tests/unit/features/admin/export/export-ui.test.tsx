import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExportButton from '@/features/admin/export/ExportButton';
import { exportHref } from '@/features/admin/export/tables';

const search = vi.hoisted(() => ({ value: 'range=7d&country=PK&cursor=abc&path=%2F' }));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search.value) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('exportHref', () => {
  it('keeps the screen filters and drops paging and panel state', () => {
    expect(exportHref('sessions', search.value)).toBe('/api/admin/export/sessions?range=7d&country=PK');
    expect(exportHref('pages', 'range=7d&preview=1', { preview: '1' })).toBe('/api/admin/export/pages?range=7d&preview=1');
    expect(exportHref('sources', '')).toBe('/api/admin/export/sources');
  });
});

describe('ExportButton', () => {
  it('renders nothing without export:csv', () => {
    const { container } = render(<ExportButton table="sessions" canExport={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('counts first, then downloads the same filters', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ok: true, rows: 1902, total: 1902, limit: 5000, from: '2026-11-07', to: '2026-11-13' }))
      .mockResolvedValueOnce(
        new Response('\uFEFF"a"\r\n', {
          headers: { 'content-disposition': 'attachment; filename="syncflow-sessions-x.csv"', 'x-export-rows': '1902' },
        }),
      );
    render(<ExportButton table="sessions" canExport />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByRole('heading', { name: 'Export 1,902 sessions?' })).toBeTruthy();
    expect(screen.getByText('7 Nov – 13 Nov 2026, with the filters on this screen. Times are in UTC.')).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/export/sessions?range=7d&country=PK&preview=1');

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/export/sessions?range=7d&country=PK');
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('offers the first 5,000 when the export is over the cap', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, rows: 5000, total: 21400, limit: 5000, from: '2026-11-07', to: '2026-11-13' }));
    render(<ExportButton table="sessions" canExport />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/This export has 21,400 rows\. The limit is 5,000\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export first 5,000' })).toBeTruthy();
  });

  it('shows the read-budget refusal with only Close', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ ok: false, error: 'budget', message: "Today's read budget can't cover this export. Try a shorter range or tomorrow." }, 429),
    );
    render(<ExportButton table="pages" canExport />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect((await screen.findByRole('alert')).textContent).toContain("Today's read budget can't cover this export.");
    expect(screen.getByRole('heading', { name: "Can't export now" })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });

  it('says so when nothing matches', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, rows: 0, total: 0, limit: 5000, from: '2026-11-13', to: '2026-11-13' }));
    render(<ExportButton table="countries" canExport />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('No places match this range and these filters.')).toBeTruthy();
  });
});
