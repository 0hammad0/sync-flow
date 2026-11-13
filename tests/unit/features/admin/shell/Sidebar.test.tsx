import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar, { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS } from '@/features/admin/shell/Sidebar';

function stubPointer(fine: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: fine && query.includes('pointer: fine'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function setup() {
  const { container } = render(
    <Sidebar brand={<span>SyncFlow</span>} nav={<a href="#sessions">Sessions</a>} footer={<button type="button">Theme</button>} />,
  );
  return container.querySelector('.admin-sidebar') as HTMLElement;
}

const enter = (el: HTMLElement, pointerType = 'mouse') => fireEvent.pointerEnter(el, { pointerType });
const leave = (el: HTMLElement, pointerType = 'mouse') => fireEvent.pointerLeave(el, { pointerType });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('Sidebar hover intent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubPointer(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens 150 ms after the pointer rests on the rail, not before', () => {
    const sidebar = setup();
    enter(sidebar);
    advance(HOVER_OPEN_DELAY_MS - 1);
    expect(sidebar.hasAttribute('data-open')).toBe(false);
    advance(1);
    expect(sidebar.getAttribute('data-open')).toBe('hover');
  });

  it('passing across (leave before 150 ms) never opens it', () => {
    const sidebar = setup();
    enter(sidebar);
    advance(100);
    leave(sidebar);
    advance(1000);
    expect(sidebar.hasAttribute('data-open')).toBe(false);
  });

  it('closes 300 ms after leaving; re-entering cancels the close', () => {
    const sidebar = setup();
    enter(sidebar);
    advance(HOVER_OPEN_DELAY_MS);
    leave(sidebar);
    advance(HOVER_CLOSE_DELAY_MS - 50);
    enter(sidebar);
    advance(1000);
    expect(sidebar.getAttribute('data-open')).toBe('hover');

    leave(sidebar);
    advance(HOVER_CLOSE_DELAY_MS - 1);
    expect(sidebar.getAttribute('data-open')).toBe('hover');
    advance(1);
    expect(sidebar.hasAttribute('data-open')).toBe(false);
  });

  it('ignores touch and coarse pointers', () => {
    const sidebar = setup();
    enter(sidebar, 'touch');
    advance(1000);
    expect(sidebar.hasAttribute('data-open')).toBe(false);

    stubPointer(false);
    enter(sidebar);
    advance(1000);
    expect(sidebar.hasAttribute('data-open')).toBe(false);
  });

  it('Esc closes a hover-open sidebar', () => {
    const sidebar = setup();
    enter(sidebar);
    advance(HOVER_OPEN_DELAY_MS);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Theme' }), { key: 'Escape' });
    expect(sidebar.hasAttribute('data-open')).toBe(false);
  });
});

describe('Sidebar tap-open (touch)', () => {
  beforeEach(() => stubPointer(false));
  afterEach(() => vi.unstubAllGlobals());

  it('the ☰ toggles it, Esc closes it and returns focus to the ☰', () => {
    const sidebar = setup();
    const tap = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(tap);
    expect(sidebar.getAttribute('data-open')).toBe('tap');
    expect(tap.getAttribute('aria-expanded')).toBe('true');
    expect(sidebar.querySelector('.admin-sidebar-backdrop')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sidebar.hasAttribute('data-open')).toBe(false);
    expect(document.activeElement).toBe(tap);
  });

  it('following a link closes it', () => {
    const sidebar = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    expect(sidebar.hasAttribute('data-open')).toBe(false);
  });
});
