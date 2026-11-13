import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';
import OfflineBanner from '@/shared/ui/OfflineBanner';
import NoResults from '@/shared/ui/illustrations/NoResults';

describe('EmptyState', () => {
  it('renders title, body, illustration and both actions', () => {
    const { container } = render(
      <EmptyState
        size="page"
        illustration={<NoResults />}
        title="No results match these filters"
        body="Try a wider date range or remove a filter."
        action={<button type="button">Clear filters</button>}
        secondaryAction={<button type="button">Last 30 days</button>}
      />
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No results match these filters' })).toBeTruthy();
    expect(screen.getByText('Try a wider date range or remove a filter.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toBeTruthy();
    expect(container.querySelector('svg.sf-illus')).not.toBeNull();
  });

  it('drops the picture in inline size and shows an icon instead', () => {
    const { container } = render(
      <EmptyState size="inline" illustration={<NoResults />} title="No results for &quot;203.0.113&quot;" />
    );
    expect(container.querySelector('svg.sf-illus')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('No results for "203.0.113"')).toBeTruthy();
  });

  it('table size: centred column with the picture, title, body and action', () => {
    const { container } = render(
      <EmptyState
        size="table"
        illustration={<NoResults />}
        title="No blocks yet"
        body="Block an IP, range, country, user or device."
        action={<button type="button">New block</button>}
      />
    );
    const root = container.firstElementChild!;
    expect(root.className).toContain('text-center');
    expect(root.className).toContain('flex-col');
    expect(container.querySelector('svg.sf-illus')).not.toBeNull();
    expect(screen.getByText('No blocks yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New block' })).toBeTruthy();
  });
});

describe('ErrorState', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('shows title, reason and the default ErrorGeneric picture, without role=alert on first render', () => {
    const { container } = render(
      <ErrorState
        title="Couldn't load sessions"
        reason="The server hit an error. It has been logged."
        action={<button type="button">Retry</button>}
      />
    );
    expect(screen.getByRole('heading', { name: "Couldn't load sessions" })).toBeTruthy();
    expect(screen.getByText('The server hit an error. It has been logged.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(container.querySelector('svg.sf-illus')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy error id' })).toBeNull();
  });

  it('uses role=alert when announce is set', () => {
    render(<ErrorState title="Couldn't load sessions" reason="x" announce />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('copies the error id to the clipboard and confirms', async () => {
    render(
      <ErrorState
        title="Couldn't load sessions"
        reason="The server hit an error. It has been logged."
        errorId="err_8k2f9a"
      />
    );
    expect(screen.getByText('err_8k2f9a')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy error id' }));
    expect(writeText).toHaveBeenCalledWith('err_8k2f9a');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Error id copied');
  });
});

describe('OfflineBanner', () => {
  let onLine = true;

  beforeEach(() => {
    onLine = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => onLine);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const goOffline = () =>
    act(() => {
      onLine = false;
      window.dispatchEvent(new Event('offline'));
    });
  const goOnline = () =>
    act(() => {
      onLine = true;
      window.dispatchEvent(new Event('online'));
    });

  it('is an empty status region while online', () => {
    render(<OfflineBanner />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows the offline copy, then "Back online." for 2 s, and refetches once', () => {
    const onReconnect = vi.fn();
    render(<OfflineBanner onReconnect={onReconnect} />);

    goOffline();
    expect(screen.getByRole('status').textContent).toBe(
      "You're offline. Showing the last loaded data. Changes are paused."
    );

    goOnline();
    expect(screen.getByRole('status').textContent).toBe('Back online.');
    expect(onReconnect).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows the offline copy on mount when already offline', () => {
    onLine = false;
    render(<OfflineBanner />);
    expect(screen.getByRole('status').textContent).toContain("You're offline.");
  });
});
