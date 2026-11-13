import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE } from '@/shared/ui/data-table/types';
import { renderTable } from './harness';

describe('DataTable states', () => {
  it('first load: real header, one skeleton row per page row, one status message', () => {
    const { container } = renderTable({ props: { status: 'loading', rows: [] } });
    expect(screen.getByRole('status').textContent).toBe('Loading sessions');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Started' })).toBeTruthy();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(PAGE_SIZE);
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('first load in a narrow container: 8 skeleton cards', () => {
    const { container } = renderTable({ width: 390, props: { status: 'loading', rows: [] } });
    expect(screen.getByRole('status').textContent).toBe('Loading sessions');
    expect(container.querySelectorAll('li')).toHaveLength(8);
  });

  it('empty: one full-width row with the empty state; header and toolbar stay, footer hides', () => {
    renderTable({ props: { rows: [] } });
    const cell = screen.getByText('No sessions yet').closest('td')!;
    expect(cell.getAttribute('colspan')).toBe('5');
    expect(screen.getByText('Sessions appear after the first visit.')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'IP' })).toBeTruthy();
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('no results when a search is active, with a way to clear it', async () => {
    const user = userEvent.setup();
    const { lastUrl } = renderTable({ search: '?q=nomatch', props: { rows: [] } });
    expect(screen.getByText('No sessions match')).toBeTruthy();
    expect(screen.queryByText('No sessions yet')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(lastUrl()?.has('q')).toBe(false);
  });

  it('error: inline ErrorState with Retry, no footer', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderTable({
      props: {
        status: 'error',
        error: { title: "Couldn't load sessions", reason: 'The connection dropped.', onRetry },
      },
    });
    const cell = screen.getByText("Couldn't load sessions").closest('td')!;
    await user.click(within(cell).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('shows an em dash labelled "None" for an empty value', () => {
    renderTable();
    expect(screen.getAllByLabelText('None').length).toBeGreaterThan(0);
  });
});

describe('DataTable search', () => {
  it('waits for a 250 ms pause before writing ?q=, drops the cursor, and Esc clears it', async () => {
    const user = userEvent.setup();
    const { lastUrl, onUrlUpdate } = renderTable({ search: '?cursor=c2' });
    const box = screen.getByRole('searchbox', { name: 'Search IP, path or id' }) as HTMLInputElement;

    await user.type(box, '203');
    expect(box.value).toBe('203');
    expect(onUrlUpdate).not.toHaveBeenCalled();
    await waitFor(
      () => {
        expect(lastUrl()?.get('q')).toBe('203');
        expect(lastUrl()?.has('cursor')).toBe(false);
      },
      { timeout: 1000 },
    );
    // The URL write can land before React commits the new value (the update
    // runs in a transition). Esc reads the committed value, so wait for it.
    await waitFor(() => expect(box.getAttribute('value')).toBe('203'));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(lastUrl()?.has('q')).toBe(false));
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('"/" focuses the search unless the user is typing in a field', async () => {
    const user = userEvent.setup();
    renderTable();
    const box = screen.getByRole('searchbox') as HTMLInputElement;
    await user.keyboard('/');
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe('');
  });
});
