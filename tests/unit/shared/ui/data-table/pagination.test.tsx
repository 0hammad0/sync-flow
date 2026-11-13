import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Pagination from '@/shared/ui/data-table/Pagination';
import { FIRST_PAGE_CURSOR } from '@/shared/ui/data-table/url-state';
import { renderTable } from './harness';

const hrefFor = (cursor: string | null) => (cursor ? `/admin/sessions?cursor=${cursor}` : '/admin/sessions');

describe('Pagination', () => {
  it('is a labelled nav with Newer/Older links and the count', () => {
    render(<Pagination prevCursor="c1" nextCursor="c3" shown={25} total={1204} hrefFor={hrefFor} onNavigate={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(nav).getByText('Showing 25 of 1,204')).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Newer' }).getAttribute('href')).toBe('/admin/sessions?cursor=c1');
    expect(within(nav).getByRole('link', { name: 'Older' }).getAttribute('href')).toBe('/admin/sessions?cursor=c3');
  });

  it('disables Newer on the first page and Older on the last (no href, not focusable)', () => {
    render(<Pagination prevCursor={null} nextCursor={null} shown={7} hrefFor={hrefFor} onNavigate={() => {}} />);
    for (const name of ['Newer', 'Older']) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('aria-disabled')).toBe('true');
      expect(link.hasAttribute('href')).toBe(false);
    }
    expect(screen.getByText('Showing 7')).toBeTruthy();
  });

  it('navigates in-app on a plain click and leaves modified clicks to the browser', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Pagination prevCursor="c1" nextCursor="c3" shown={25} hrefFor={hrefFor} onNavigate={onNavigate} />);
    await user.click(screen.getByRole('link', { name: 'Older' }));
    expect(onNavigate).toHaveBeenCalledWith('c3');

    onNavigate.mockClear();
    fireEvent.click(screen.getByRole('link', { name: 'Newer' }), { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('load-more mode has a single link and no Newer', () => {
    render(<Pagination mode="load-more" prevCursor={null} nextCursor="tok2" shown={25} hrefFor={hrefFor} onNavigate={() => {}} />);
    expect(screen.getByRole('link', { name: 'Load more' }).getAttribute('href')).toBe('/admin/sessions?cursor=tok2');
    expect(screen.queryByRole('link', { name: 'Newer' })).toBeNull();
  });
});

describe('DataTable cursor paging', () => {
  it('Older writes ?cursor= and keeps sort and search in the link', async () => {
    const user = userEvent.setup();
    const { lastUrl } = renderTable({ search: '?sort=pages&q=203' });
    const older = screen.getByRole('link', { name: 'Older' });
    expect(older.getAttribute('href')).toBe('/admin/sessions?sort=pages&q=203&cursor=c2');

    await user.click(older);
    await waitFor(() => expect(lastUrl()?.get('cursor')).toBe('c2'));
    expect(lastUrl()?.get('sort')).toBe('pages');
  });

  it('Newer back to the first page removes the cursor', async () => {
    const user = userEvent.setup();
    const { lastUrl } = renderTable({
      search: '?cursor=c2',
      props: { page: { prevCursor: FIRST_PAGE_CURSOR, nextCursor: 'c3', total: 1204 } },
    });
    const newer = screen.getByRole('link', { name: 'Newer' });
    expect(newer.getAttribute('href')).toBe('/admin/sessions');
    await user.click(newer);
    await waitFor(() => expect(lastUrl()?.has('cursor')).toBe(false));
  });

  it('clears ticked rows on a page change', async () => {
    const user = userEvent.setup();
    renderTable({ props: { bulkActions: () => null } });
    await user.click(screen.getByRole('checkbox', { name: 'Select 203.0.113.1' }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Older' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull());
  });
});
