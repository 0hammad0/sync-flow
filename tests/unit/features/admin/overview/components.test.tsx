import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import type { KpisDto, RangeMeta } from '@/features/admin/analytics/types';
import { KpiRow } from '@/features/admin/overview/components/KpiCard';
import TopList from '@/features/admin/overview/components/TopList';
import { buildKpiCards } from '@/features/admin/overview/kpis';
import { TooltipProvider } from '@/shared/ui/Tooltip';

const range: ResolvedRange = { kind: '7d', from: '2026-11-08', to: '2026-11-14', days: 7, granularity: 'day', clamped: false };
const meta: RangeMeta = { from: range.from, to: range.to, granularity: 'day', sampled: true, sampledDays: ['2026-11-13'], fallbackDays: [] };
const dto: KpisDto = {
  current: { visitors: 12, sessions: 12, pageviews: 30, avgEngagedMs: 61_000, bounceRate: 0.25 },
  previous: { visitors: 0, sessions: 0, pageviews: 0, avgEngagedMs: null, bounceRate: null },
  meta,
  previousMeta: meta,
};

describe('KpiRow', () => {
  it('renders 5 linked cards with full names, "—" deltas for an empty previous period, and the sampled note', () => {
    render(
      <TooltipProvider>
        <KpiRow cards={buildKpiCards(dto, range)} sampled incomplete={false} />
      </TooltipProvider>,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links[0].getAttribute('href')).toBe('/admin/sessions?range=7d');
    expect(links[0].getAttribute('aria-label')).toBe('Visitors 12, no data in the previous 7 days');
    expect(within(links[3]).getByText('1m 01s')).toBeTruthy();
    expect(within(links[0]).getByText('—')).toBeTruthy();
    expect(screen.getByText('Sampled')).toBeTruthy();
    expect(screen.getByText(/counts were scaled ×2/)).toBeTruthy();
  });
});

describe('TopList', () => {
  it('shows rows with links and View all; an empty list says so', () => {
    const { rerender } = render(
      <TopList items={[{ label: '/', value: 9, href: '/admin/pages?path=%2F&range=7d' }]} total={9} viewAllHref="/admin/pages?range=7d" />,
    );
    expect(screen.getByRole('link', { name: /\// }).getAttribute('href')).toBe('/admin/pages?path=%2F&range=7d');
    expect(screen.getByRole('link', { name: 'View all' }).getAttribute('href')).toBe('/admin/pages?range=7d');
    rerender(<TopList items={[]} viewAllHref="/admin/pages" sampled />);
    expect(screen.getByText('No visits in this range')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View all' })).toBeNull();
    expect(screen.getByText('Sampled')).toBeTruthy();
  });
});
