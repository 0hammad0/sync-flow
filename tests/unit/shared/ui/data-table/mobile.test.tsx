import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// The harness mocks next/navigation: import it before the table module.
import { prefetch, renderTable } from './harness';
import { tableViewFor } from '@/shared/ui/data-table/DataTable';

afterEach(() => vi.unstubAllGlobals());

describe('tableViewFor', () => {
  it('switches to cards under a 640 px container (04-responsive.md), not at the 768 px viewport breakpoint', () => {
    expect(tableViewFor(390, 'cards')).toBe('cards');
    expect(tableViewFor(639, 'cards')).toBe('cards');
    expect(tableViewFor(640, 'cards')).toBe('table');
    expect(tableViewFor(767, 'cards')).toBe('table');
  });

  it('leaves the choice to CSS container queries before the first measurement (server render)', () => {
    expect(tableViewFor(null, 'cards')).toBe('css');
  });

  it('never uses cards in scroll mode', () => {
    expect(tableViewFor(320, 'scroll')).toBe('table');
  });
});

describe('MobileCardList inside DataTable', () => {
  it('renders a list of cards, not a table, in a narrow container', () => {
    renderTable({ width: 390 });
    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'Sessions' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(6);

    // Title slot is the heading and the row link; trailing and subtitle follow.
    const first = cards[0];
    const link = within(first).getByRole('link', { name: '203.0.113.1' });
    expect(link.getAttribute('href')).toBe('/admin/sessions/s1');
    expect(within(first).getByRole('heading', { name: '203.0.113.1' })).toBeTruthy();
    expect(within(first).getByText('1m ago')).toBeTruthy();
    expect(within(first).getByText('PK')).toBeTruthy();
    // Meta slot joins the remaining fields with "·".
    expect(first.textContent).toContain('1 · ');
  });

  it('renders the table, not cards, in a wide container', () => {
    renderTable({ width: 1024 });
    expect(screen.getByRole('table', { name: 'Sessions' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Sessions' })).toBeNull();
  });

  it('gives each card a checkbox when the table has bulk actions', () => {
    renderTable({ width: 390, props: { bulkActions: () => null } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });

  it('prefetches a row detail page on hover', () => {
    prefetch.mockClear();
    renderTable({ width: 390 });
    fireEvent.pointerEnter(screen.getAllByRole('listitem')[1]);
    expect(prefetch).toHaveBeenCalledWith('/admin/sessions/s2');
  });
});
