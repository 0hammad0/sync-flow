import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderTable } from './harness';
import { nextSort } from '@/shared/ui/data-table/url-state';

const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(`^${name}`) });

describe('DataTable sorting', () => {
  it('marks only the sorted column with aria-sort (table default when the URL has none)', () => {
    renderTable();
    expect(header('Started').getAttribute('aria-sort')).toBe('descending');
    expect(header('Pages').hasAttribute('aria-sort')).toBe(false);
    expect(header('IP').hasAttribute('aria-sort')).toBe(false);
  });

  it('offers a sort button only for columns in the server allowlist', () => {
    renderTable();
    expect(within(header('Pages')).queryByRole('button')).not.toBeNull();
    // `sortable: true` in meta, but no index: plain header.
    expect(within(header('Country')).queryByRole('button')).toBeNull();
    expect(within(header('IP')).queryByRole('button')).toBeNull();
  });

  it('cycles first direction → other direction → table default, writing ?sort= and dropping the cursor', async () => {
    const user = userEvent.setup();
    const { lastUrl } = renderTable({ search: '?cursor=abc&q=203' });
    const button = () => within(header('Pages')).getByRole('button');

    await user.click(button());
    await waitFor(() => expect(lastUrl()?.get('sort')).toBe('-pages'));
    expect(lastUrl()?.has('cursor')).toBe(false);
    expect(lastUrl()?.get('q')).toBe('203');
    // State updates run in a transition: wait for the render too.
    await waitFor(() => expect(header('Pages').getAttribute('aria-sort')).toBe('descending'));
    expect(header('Started').hasAttribute('aria-sort')).toBe(false);

    await user.click(button());
    await waitFor(() => expect(lastUrl()?.get('sort')).toBe('pages'));
    await waitFor(() => expect(header('Pages').getAttribute('aria-sort')).toBe('ascending'));

    // Third click: back to the table default, which is not written to the URL.
    await user.click(button());
    await waitFor(() => expect(lastUrl()?.has('sort')).toBe(false));
    await waitFor(() => expect(header('Started').getAttribute('aria-sort')).toBe('descending'));
  });

  it('falls back to the default for a sort outside the allowlist', () => {
    renderTable({ search: '?sort=-country' });
    expect(header('Started').getAttribute('aria-sort')).toBe('descending');
    expect(header('Country').hasAttribute('aria-sort')).toBe(false);
  });
});

describe('nextSort', () => {
  it('starts descending for defaultDesc columns and ascending otherwise', () => {
    expect(nextSort('-started_at', 'pages', true, '-started_at')).toBe('-pages');
    expect(nextSort('-started_at', 'path', false, '-started_at')).toBe('path');
  });

  it('flips the default column instead of getting stuck on it', () => {
    expect(nextSort('-started_at', 'started_at', true, '-started_at')).toBe('started_at');
    expect(nextSort('started_at', 'started_at', true, '-started_at')).toBe('-started_at');
  });
});
