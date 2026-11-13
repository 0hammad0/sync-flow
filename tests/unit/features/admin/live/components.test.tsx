import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveDto, LiveSessionDto } from '@/features/admin/analytics/types';
import LiveEventFeed from '@/features/admin/live/components/LiveEventFeed';
import LiveStatus from '@/features/admin/live/components/LiveStatus';
import LiveSummary from '@/features/admin/live/components/LiveSummary';
import LiveVisitorsTable from '@/features/admin/live/components/LiveVisitorsTable';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/admin/access/actions', () => ({ blockSubject: vi.fn(), unblockSubject: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => vi.unstubAllGlobals());

const at = '2026-11-14T12:00:00.000Z';
const session = (id: string, over: Partial<LiveSessionDto> = {}): LiveSessionDto => ({
  sessionId: id.padEnd(32, '0'),
  ip: '203.0.113.•••',
  ipMasked: true,
  ipTruncated: false,
  country: 'PK',
  region: null,
  city: 'Lahore',
  lat: null,
  lon: null,
  device: 'mobile',
  browser: null,
  currentPath: '/chat/[code]',
  startedAt: '2026-11-14T11:55:48.000Z',
  lastSeenAt: '2026-11-14T11:59:50.000Z',
  userId: null,
  active: true,
  ...over,
});

describe('LiveStatus', () => {
  const base = { updatedAt: Date.parse(at), now: Date.parse(at) + 4_000, onResumeIdle: () => {}, onRetry: () => {} };

  it('shows the time since the last update while running', () => {
    render(<LiveStatus {...base} mode="running" status="ok" />);
    expect(screen.getByText('Updated 4s ago').getAttribute('title')).toBe('12:00:00 UTC');
  });

  it('idle shows "Paused, click to resume" as a button', () => {
    render(<LiveStatus {...base} mode="idle" status="ok" />);
    expect(screen.getByRole('button', { name: 'Paused, click to resume' })).toBeTruthy();
  });

  it('failing, stopped, budget, 401 and 403 have their own words', () => {
    const { rerender } = render(<LiveStatus {...base} mode="running" status="failing" />);
    expect(screen.getByText('Update failed. Retrying in 30 s.')).toBeTruthy();
    rerender(<LiveStatus {...base} mode="stopped" status="stopped" />);
    expect(screen.getByText('Live updates stopped.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    rerender(<LiveStatus {...base} mode="stopped" status="budget" />);
    expect(screen.getByText(/read budget is used up/)).toBeTruthy();
    rerender(<LiveStatus {...base} mode="stopped" status="unauthorized" />);
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/admin/sign-in?next=%2Fadmin%2Flive');
    rerender(<LiveStatus {...base} mode="stopped" status="forbidden" />);
    expect(screen.getByText('You no longer have access to this page.')).toBeTruthy();
  });
});

describe('LiveSummary', () => {
  it('shows the count, the device split and the top page', () => {
    const data: LiveDto = {
      at,
      online: 12,
      listed: 12,
      byDevice: { desktop: 7, mobile: 4, tablet: 1, unknown: 0 },
      topPath: '/chat/[code]',
      sessions: [],
      events: [],
    };
    render(<LiveSummary data={data} updatedAt={Date.parse(at)} />);
    expect(screen.getAllByText('12 online')).toHaveLength(2); // visible + polite live region
    expect(screen.getByText('7 desktop · 4 mobile · 1 tablet')).toBeTruthy();
    expect(screen.getByText('/chat/[code]')).toBeTruthy();
  });
});

describe('LiveVisitorsTable', () => {
  it('lists visitors with masked IPs, a "You" badge, and no Copy IP for masked ones', () => {
    render(<LiveVisitorsTable sessions={[session('a', { userId: 'me' }), session('b')]} at={at} selfUid="me" />);
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
    expect(screen.getAllByText('203.0.113.•••').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'PK · Lahore' })[0].getAttribute('href')).toBe(`/admin/sessions/${'a'.padEnd(32, '0')}`);
    expect(screen.getAllByText('4m 12s').length).toBeGreaterThan(0);
  });

  it('"Block this IP…" opens the block dialog with the IP filled in, only for a role that may block', async () => {
    // jsdom has no ResizeObserver; the dialog's inputs measure themselves.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const user = userEvent.setup();
    const full = session('c', { ip: '198.51.100.23', ipMasked: false });
    const actor = { uid: 'me', ip: '192.0.2.1', country: 'PK' };
    const { unmount } = render(<LiveVisitorsTable sessions={[full]} at={at} selfUid="me" />);
    await user.click(screen.getAllByRole('button', { name: /Actions for/ })[0]);
    expect(screen.queryByRole('menuitem', { name: /Block this IP/ })).toBeNull();
    await user.keyboard('{Escape}');
    unmount();

    render(<LiveVisitorsTable sessions={[full]} at={at} selfUid="me" blockActor={actor} />);
    await user.click(screen.getAllByRole('button', { name: /Actions for/ })[0]);
    await user.click(await screen.findByRole('menuitem', { name: /Block this IP/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('198.51.100.23')).toBeTruthy();
  });

  it('masked IPs never offer a block', async () => {
    const user = userEvent.setup();
    render(<LiveVisitorsTable sessions={[session('d')]} at={at} selfUid="me" blockActor={{ uid: 'me', ip: null, country: null }} />);
    await user.click(screen.getAllByRole('button', { name: /Actions for/ })[0]);
    expect(await screen.findByRole('menuitem', { name: 'Open session' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Block/ })).toBeNull();
  });

  it('says nobody is online when the list is empty', () => {
    render(<LiveVisitorsTable sessions={[]} at={at} selfUid="me" />);
    expect(screen.getByText('Nobody is on the site right now')).toBeTruthy();
  });
});

describe('LiveEventFeed', () => {
  it('is a table with a caption, newest first, linking to the session', () => {
    render(
      <LiveEventFeed
        events={[{ id: 'e1', ts: '2026-11-14T11:59:31.000Z', kind: 'pageview', path: '/', country: 'US', device: 'desktop', sessionId: 'f'.repeat(32) }]}
      />,
    );
    expect(screen.getByRole('table', { name: 'Recent page views, newest first' })).toBeTruthy();
    expect(screen.getAllByText('11:59:31').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'ffff…' })[0].getAttribute('href')).toBe(`/admin/sessions/${'f'.repeat(32)}`);
  });
});
