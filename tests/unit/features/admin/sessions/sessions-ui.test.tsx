import { render, screen, within } from '@testing-library/react';
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import type { SessionDetailDto, SessionRowDto } from '@/server/analytics/dto';
import { maskIpDto } from '@/server/analytics/session-dto';
import { TooltipProvider } from '@/shared/ui/Tooltip';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/sessions',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/admin/access/actions', () => ({ blockSubject: vi.fn(), unblockSubject: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: SessionsTable } = await import('@/features/admin/sessions/components/SessionsTable');
const { default: SessionTimeline } = await import('@/features/admin/sessions/components/SessionTimeline');
const { default: SessionHeader } = await import('@/features/admin/sessions/components/SessionHeader');

const FULL_IP = '203.0.113.77';
const ACTOR = { uid: 'owner-uid', ip: '198.51.100.1', country: 'US' };

function row(over: Partial<SessionRowDto> = {}): SessionRowDto {
  return {
    id: '7f3a9c'.padEnd(32, '0'),
    startedAt: '2026-11-14T14:02:31.000Z',
    lastSeenAt: '2026-11-14T14:06:43.000Z',
    durationMs: 252_000,
    pageviews: 5,
    engagedMs: 220_000,
    entryPath: '/',
    exitPath: '/chat/[code]',
    country: 'PK',
    region: 'Punjab',
    city: 'Lahore',
    device: 'mobile',
    browser: 'Safari',
    os: 'iOS',
    referrerHost: 'google.com',
    utmSource: null,
    userId: null,
    sampled: false,
    ip: FULL_IP,
    ipMasked: false,
    ipTruncated: false,
    ...over,
  };
}

const Nuqs = withNuqsTestingAdapter();
function Providers({ children }: { children: ReactNode }) {
  return (
    <Nuqs>
      <TooltipProvider>{children}</TooltipProvider>
    </Nuqs>
  );
}

function renderTable(rows: SessionRowDto[], access: { canSeeIp: boolean; canBlock: boolean }) {
  return render(
    <SessionsTable
      rows={rows}
      total={rows.length}
      page={{ prevCursor: null, nextCursor: null }}
      filter={null}
      today="2026-11-14"
      canSeeIp={access.canSeeIp}
      canBlock={access.canBlock}
      canExport={false}
      canOpenUsers
      actor={access.canBlock ? ACTOR : null}
    />,
    { wrapper: Providers },
  );
}

describe('SessionsTable: IP masking in rendered rows', () => {
  it('a role without ip:read never gets the full IP in the HTML', () => {
    const masked = maskIpDto(row(), false);
    const { container } = renderTable([masked], { canSeeIp: false, canBlock: false });
    expect(container.innerHTML).not.toContain(FULL_IP);
    expect(screen.getAllByText('203.0.113.•••').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Copy IP/ })).toBeNull();
    // Search does not offer IPs to this role.
    expect(screen.getByPlaceholderText('User id…')).toBeTruthy();
  });

  it('ip:read shows the full IP with a copy button', () => {
    renderTable([row()], { canSeeIp: true, canBlock: false });
    expect(screen.getAllByRole('button', { name: `Copy IP ${FULL_IP}` }).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('Full IP or user id…')).toBeTruthy();
  });

  it('a truncated IP is labelled', () => {
    renderTable([row({ ip: '203.0.113.0', ipTruncated: true })], { canSeeIp: true, canBlock: false });
    expect(screen.getAllByText('truncated').length).toBeGreaterThan(0);
  });

  it('row actions: Block only with blocks:write', () => {
    renderTable([row()], { canSeeIp: true, canBlock: false });
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('row actions: shown with blocks:write and a full IP', () => {
    renderTable([row()], { canSeeIp: true, canBlock: true });
    expect(screen.getAllByRole('button', { name: /Actions for session 7f3a9c00/ }).length).toBeGreaterThan(0);
  });

  it('rows link to the detail page and show the formatted cells', () => {
    renderTable([row()], { canSeeIp: true, canBlock: false });
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === `/admin/sessions/${row().id}`);
    expect(links.length).toBeGreaterThan(0);
    expect(screen.getAllByText('/ → /chat/[code]').length).toBeGreaterThan(0);
    expect(screen.getAllByText('14:02:31').length).toBeGreaterThan(0);
  });
});

describe('SessionTimeline', () => {
  it('lists page views oldest first, then the last event', () => {
    render(
      <SessionTimeline
        pages={[
          { id: 'b', ts: '2026-11-14T14:03:18.000Z', path: '/chat/[code]', engagedMs: 179_000, wallMs: 205_000, scrollMax: 75 },
          { id: 'a', ts: '2026-11-14T14:02:31.000Z', path: '/', engagedMs: 41_000, wallMs: 47_000, scrollMax: 100 },
        ]}
        startedAt="2026-11-14T14:02:31.000Z"
        lastSeenAt="2026-11-14T14:06:43.000Z"
        pageCapReached
      />,
      { wrapper: Providers },
    );
    const items = within(screen.getByRole('list', { name: 'Page views' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('/');
    expect(items[0].textContent).toContain('0m 47s on page');
    expect(items[1].textContent).toContain('/chat/[code]');
    expect(items[1].textContent).toContain('+0:47');
    expect(items[1].textContent).toContain('Scrolled 75%');
    expect(items[2].textContent).toContain('Last event');
    expect(screen.getByText(/100-page limit/)).toBeTruthy();
  });
});

describe('SessionHeader', () => {
  const detail = (over: Partial<SessionRowDto> = {}): SessionDetailDto => ({
    ...row(over),
    tz: 'Asia/Karachi',
    lat: null,
    lon: null,
    browserVersion: '18',
    viewport: { w: 390, h: 844 },
    utmMedium: null,
    utmCampaign: null,
    vitals: { lcp: 1200, inp: 120, cls: 0.04 },
    pages: [],
    pageCapReached: false,
  });

  it('masked IP: no full IP, no Block button', () => {
    const { container } = render(
      <SessionHeader session={maskIpDto(detail(), false)} canBlock={false} canOpenUsers actor={null} />,
      { wrapper: Providers },
    );
    expect(container.innerHTML).not.toContain(FULL_IP);
    expect(screen.queryByRole('button', { name: 'Block IP' })).toBeNull();
    expect(screen.getByText('LCP 1.2 s · INP 120 ms · CLS 0.04')).toBeTruthy();
  });

  it('blocks:write: Block IP; a signed-in user links to the user page', () => {
    render(<SessionHeader session={detail({ userId: 'AbCdEfGhIjKlMnOpQrStUvWxYz12' })} canBlock canOpenUsers actor={ACTOR} />, {
      wrapper: Providers,
    });
    expect(screen.getByRole('button', { name: 'Block IP' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'AbCdEfGhIjKlMnOpQrStUvWxYz12' }).getAttribute('href')).toBe(
      '/admin/users/AbCdEfGhIjKlMnOpQrStUvWxYz12',
    );
  });
});
