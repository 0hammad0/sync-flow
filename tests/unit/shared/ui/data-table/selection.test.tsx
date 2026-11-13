import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BulkSelection } from '@/shared/ui/data-table/types';
import { renderTable } from './harness';

function renderSelectable(total = 1204) {
  const bulk = vi.fn<(selection: BulkSelection) => void>();
  const utils = renderTable({
    props: {
      page: { prevCursor: null, nextCursor: 'c2', total },
      bulkActions: (selection) => {
        bulk(selection);
        return (
          <button type="button" onClick={() => bulk(selection)}>
            Block
          </button>
        );
      },
    },
  });
  return { ...utils, bulk };
}

const rowBox = (ip: string) => screen.getByRole('checkbox', { name: `Select ${ip}` });
const headerBox = () => screen.getByRole('checkbox', { name: 'Select all on this page' });
const bar = () => screen.queryByRole('region', { name: 'Bulk actions' });

describe('DataTable selection and BulkBar', () => {
  it('shows the toolbar until a row is ticked, then the BulkBar replaces it', async () => {
    const user = userEvent.setup();
    const { bulk } = renderSelectable();
    expect(bar()).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search IP, path or id' })).toBeTruthy();

    await user.click(rowBox('203.0.113.1'));
    await user.click(rowBox('203.0.113.3'));

    expect(within(bar()!).getByText('2 selected')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(headerBox().getAttribute('aria-checked')).toBe('mixed');
    expect(bulk).toHaveBeenLastCalledWith({ allMatching: false, ids: ['s1', 's3'] });
  });

  it('header checkbox selects the whole page', async () => {
    const user = userEvent.setup();
    renderSelectable();
    await user.click(headerBox());
    expect(within(bar()!).getByText('6 selected')).toBeTruthy();
    expect(headerBox().getAttribute('aria-checked')).toBe('true');
  });

  it('"Select all matching" sends the filter, not ids, and notes the 1,000 cap', async () => {
    const user = userEvent.setup();
    const { bulk } = renderSelectable();
    await user.click(rowBox('203.0.113.2'));
    await user.click(within(bar()!).getByRole('button', { name: 'Select all 1,204 matching' }));

    expect(within(bar()!).getByText('All 1,204 matching selected')).toBeTruthy();
    expect(within(bar()!).getByText('Up to 1,000 at a time')).toBeTruthy();
    expect(bulk).toHaveBeenLastCalledWith({ allMatching: true, total: 1204 });
  });

  it('Shift+click ticks the range between two rows', async () => {
    const user = userEvent.setup();
    const { bulk } = renderSelectable();
    await user.click(rowBox('203.0.113.2'));
    await user.keyboard('{Shift>}');
    await user.click(rowBox('203.0.113.5'));
    await user.keyboard('{/Shift}');
    expect(within(bar()!).getByText('4 selected')).toBeTruthy();
    expect(bulk).toHaveBeenLastCalledWith({ allMatching: false, ids: ['s2', 's3', 's4', 's5'] });
  });

  it('Clear and Esc both empty the selection and bring the toolbar back', async () => {
    const user = userEvent.setup();
    renderSelectable();
    await user.click(rowBox('203.0.113.1'));
    await user.click(within(bar()!).getByRole('button', { name: 'Clear selection' }));
    expect(bar()).toBeNull();

    await user.click(rowBox('203.0.113.4'));
    expect(bar()).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(bar()).toBeNull();
    expect(rowBox('203.0.113.4').getAttribute('aria-checked')).toBe('false');
  });

  it('has no checkboxes when the table has no bulk actions', () => {
    renderTable();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
