import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResultDto } from '@/features/admin/shell/search-types';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  prefetch: vi.fn(),
  search: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, prefetch: h.prefetch, replace: vi.fn(), refresh: vi.fn() }),
}));
// The server action module is server code; the palette only receives it as a prop.
vi.mock('@/features/admin/shell/actions', () => ({ searchAdmin: h.search }));
// next/dynamic in jsdom: render the lazy palette as a marker so the trigger test stays about the trigger.
vi.mock('next/dynamic', () => ({
  default: () =>
    function Lazy(props: { open?: boolean }) {
      return <div data-testid="lazy" data-open={String(Boolean(props.open))} />;
    },
}));

const { default: CommandPalette } = await import('@/features/admin/shell/CommandPalette');
const { default: CommandPaletteTrigger } = await import('@/features/admin/shell/CommandPaletteTrigger');
const { default: ShellFrame } = await import('@/features/admin/shell/ShellFrame');
const { NAV_GROUPS, filterNav } = await import('@/features/admin/shell/nav');

type Role = 'owner' | 'viewer';
const VIEWER_DENIED = new Set(['audit:read', 'settings:write', 'blocks:write', 'ip:read']);
const groupsFor = (role: Role) => filterNav(NAV_GROUPS, (p) => role === 'owner' || !VIEWER_DENIED.has(p));

function Harness({ role = 'owner' as Role, onClose = vi.fn() }) {
  const [open, setOpen] = useState(true);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return (
    <ShellFrame initialMode="auto">
      <button type="button" ref={(el) => void (returnFocusRef.current = el)}>
        opener
      </button>
      <CommandPalette
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onClose();
        }}
        returnFocusRef={returnFocusRef}
        groups={groupsFor(role)}
        actions={role === 'owner' ? ['new-block', 'toggle-theme', 'sign-out'] : ['toggle-theme', 'sign-out']}
        canSeeIp={role === 'owner'}
        blockActor={role === 'owner' ? { uid: 'u', ip: null, country: null } : null}
        search={h.search}
      />
    </ShellFrame>
  );
}

const input = () => screen.getByRole('combobox');
const options = () => screen.getAllByRole('option');
const activeTitle = () => {
  const id = input().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id)?.textContent : null;
};
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const key = (k: string, extra: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(input(), { key: k, ...extra });

describe('CommandPalette', () => {
  beforeEach(() => {
    h.push.mockReset();
    h.search.mockReset();
    window.localStorage.clear();
  });

  it('is a labelled dialog with a combobox that controls a grouped listbox', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Search and jump' })).toBeTruthy();
    const listbox = screen.getByRole('listbox');
    expect(input().getAttribute('aria-controls')).toBe(listbox.id);
    expect(within(listbox).getByRole('group', { name: 'Pages' })).toBeTruthy();
    expect(within(listbox).getByRole('group', { name: 'Actions' })).toBeTruthy();
    expect(document.activeElement).toBe(input());
  });

  it('lists the same pages as the sidebar for the role; a viewer never sees Settings, Audit or New block', () => {
    render(<Harness role="viewer" />);
    const titles = options().map((o) => o.textContent);
    expect(titles.some((t) => t?.startsWith('Sessions'))).toBe(true);
    expect(titles.some((t) => t?.startsWith('Users'))).toBe(true);
    expect(titles.some((t) => t?.includes('Settings'))).toBe(false);
    expect(titles.some((t) => t?.includes('Audit log'))).toBe(false);
    expect(titles.some((t) => t?.includes('New block'))).toBe(false);
  });

  it('↑/↓ move and wrap; Enter opens the page; Tab keeps focus in the input', () => {
    render(<Harness />);
    expect(activeTitle()).toContain('Overview');
    key('ArrowUp');
    expect(activeTitle()).toContain('Sign out');
    key('ArrowDown');
    key('ArrowDown');
    expect(activeTitle()).toContain('Live');
    key('Tab');
    expect(document.activeElement).toBe(input());
    key('Enter');
    expect(h.push).toHaveBeenCalledWith('/admin/live');
  });

  it('filters pages and actions instantly, with no server call for plain text', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    type('sess');
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('Sessions')]);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(h.search).not.toHaveBeenCalled();
    type('zzzz');
    expect(screen.getByText('No results for “zzzz”.')).toBeTruthy();
    vi.useRealTimers();
  });

  it('server search: debounced 200 ms, groups shown after Pages, Enter jumps to the detail', async () => {
    vi.useFakeTimers();
    const result: SearchResultDto = {
      groups: [
        {
          id: 'ip',
          label: 'IP address',
          items: [{ id: 'ip:sessions', title: 'Sessions from 203.0.113.7', subtitle: null, href: '/admin/sessions?q=203.0.113.7', action: null, copy: '203.0.113.7' }],
        },
      ],
      notice: null,
    };
    h.search.mockResolvedValue({ ok: true, data: result });
    render(<Harness />);
    type('203.0.113.7');
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(h.search).not.toHaveBeenCalled();
    expect(screen.getByText('Searching')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.search).toHaveBeenCalledWith({ q: '203.0.113.7' });
    expect(screen.getByRole('group', { name: 'IP address' })).toBeTruthy();
    key('Enter');
    expect(h.push).toHaveBeenCalledWith('/admin/sessions?q=203.0.113.7');
    vi.useRealTimers();
  });

  it('rate limited and failed searches say so; pages still work', async () => {
    vi.useFakeTimers();
    h.search.mockResolvedValueOnce({ ok: false, error: 'rate_limited', retryAfterSec: 10 });
    render(<Harness />);
    type('ab7kq2mz');
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByText('Too many searches. Wait a moment.')).toBeTruthy();
    h.search.mockRejectedValueOnce(new Error('network'));
    type('ab7kq2mx');
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByText('Search failed. Pages and actions still work.')).toBeTruthy();
    vi.useRealTimers();
  });

  it('a partial IP gets a hint and no server call', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    type('39.4.2');
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByText('Type the full IP address.')).toBeTruthy();
    expect(h.search).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('Esc closes and focus returns to what opened it; a visited page lands in Recent', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Harness onClose={onClose} />);
    key('Escape');
    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe('opener');
    unmount();

    render(<Harness />);
    type('Rooms');
    key('Enter');
    expect(JSON.parse(window.localStorage.getItem('sf-admin-recent')!)).toEqual([{ id: 'page:/admin/rooms', title: 'Rooms', href: '/admin/rooms' }]);
  });
});

describe('CommandPaletteTrigger', () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = () =>
    render(
      <ShellFrame initialMode="auto">
        <CommandPaletteTrigger groups={groupsFor('viewer')} actions={['toggle-theme']} canSeeIp={false} blockActor={null} />
        <div id="admin-content">
          <input aria-label="page text" />
        </div>
      </ShellFrame>,
    );
  const palette = () => screen.queryByTestId('lazy');

  it('mounts nothing until first opened (the palette is a lazy chunk)', () => {
    setup();
    expect(palette()).toBeNull();
  });

  it('⌘K and Ctrl+K open it, even while typing; the top-bar button opens it too', () => {
    setup();
    fireEvent.keyDown(screen.getByLabelText('page text'), { key: 'k', metaKey: true });
    expect(palette()?.dataset.open).toBe('true');
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(palette()?.dataset.open).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Search and jump' }));
    expect(palette()?.dataset.open).toBe('true');
  });

  it('`/` opens the palette when the page has no search box, never while typing', () => {
    setup();
    fireEvent.keyDown(screen.getByLabelText('page text'), { key: '/' });
    expect(palette()).toBeNull();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(palette()?.dataset.open).toBe('true');
  });

  it('`/` focuses the page search box when there is one', () => {
    setup();
    const box = document.createElement('input');
    box.type = 'search';
    document.getElementById('admin-content')!.appendChild(box);
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(box);
    expect(palette()).toBeNull();
  });

  it('ignores ⌘K while another dialog is open (one modal at a time)', () => {
    setup();
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    document.body.appendChild(other);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(palette()).toBeNull();
    other.remove();
  });
});
