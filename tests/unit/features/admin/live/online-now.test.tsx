import { act } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineNowBadge, OnlineNowDot } from '@/features/admin/live/components/OnlineNow';
import PollingProvider from '@/features/admin/live/PollingProvider';
import { ONLINE_QUERY_KEY } from '@/features/admin/live/hooks/useLivePoll';
import { initialSnapshot } from '@/features/admin/live/poll';

// "N online" in the top bar and the Overview badge share one browser cache.
// At >= 1024 px the top bar fetches the count first; the Overview badge's HTML
// streams in later and must still hydrate to exactly what the server rendered.

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function matchWidth(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

/** The browser's shared poll cache, already holding a count (the top bar fetched it). */
function seedSharedCount(count: number) {
  function Seed() {
    const client = useQueryClient();
    client.setQueryData(ONLINE_QUERY_KEY, { ...initialSnapshot({ count, at: new Date().toISOString() }, Date.now()) });
    return null;
  }
  renderToString(
    <PollingProvider>
      <Seed />
    </PollingProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('OnlineNow hydration', () => {
  it('the Overview badge hydrates without a mismatch when the shared cache already has the count', async () => {
    matchWidth(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'ok', data: { count: 3, at: '' } }))));
    // Server HTML: no cache on the server, so the skeleton.
    const html = renderToString(<OnlineNowBadge />);
    seedSharedCount(3);

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const onRecoverableError = vi.fn();
    await act(async () => {
      hydrateRoot(container, <OnlineNowBadge />, { onRecoverableError });
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    // After hydration the cached count shows.
    expect(container.textContent).toContain('3 online now');
  });

  it('the top-bar slot is in the server HTML and hidden under 1024 px by CSS', () => {
    const html = renderToString(<OnlineNowDot />);
    expect(html).toMatch(/class="hidden min-w-28 items-center justify-end lg:flex"/);
  });
});
