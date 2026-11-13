import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LineChart, { type LinePoint } from '@/shared/ui/charts/LineChart';
import LineChartPlot from '@/shared/ui/charts/LineChartPlot';

// jsdom has no layout, so ResponsiveContainer would measure 0 × 0 and draw
// nothing. Give the chart a fixed size instead.
vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children) ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 600, height: 240 }) : null,
  };
});

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 9);
const data: LinePoint[] = [120, 180, 312, 240, 200].map((value, i) => ({ t: START + i * DAY, value, compare: value - 20 }));
const SUMMARY = 'Visitors, last 5 days: 1,052 total, up 10.5% from the previous 5 days. Peak 312 on 11 Nov.';

describe('LineChart', () => {
  it('labels the chart with the summary sentence and switches to a real table', async () => {
    const user = userEvent.setup();
    render(<LineChart label="Visitors" data={data} summary={SUMMARY} bucket="day" />);

    expect(screen.getByRole('img', { name: SUMMARY })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Table' }));

    const table = screen.getByRole('table', { name: 'Visitors' });
    expect(table).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'This period' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Previous' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Wed 11 Nov 2026' })).toBeTruthy();
    expect(screen.getByText('312')).toBeTruthy();
    // Change has a sign, not only a colour.
    expect(screen.getAllByText('+6.8%').length).toBeGreaterThan(0);
    expect(screen.queryByRole('img', { name: SUMMARY })).toBeNull();
  });

  it('shows the empty state, and no table switch, when every value is 0', () => {
    const zeros = data.map((p) => ({ t: p.t, value: 0 }));
    render(<LineChart label="Visitors" data={zeros} summary="No visits." bucket="day" />);
    expect(screen.getByText('No visits in this range')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Table' })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a Sampled badge when the range has sampled days', () => {
    render(<LineChart label="Visitors" data={data} summary={SUMMARY} bucket="day" sampled />);
    expect(screen.getByText('Sampled')).toBeTruthy();
  });

  it('names both series with line samples (solid and dashed), not colour alone', () => {
    const { container } = render(<LineChart label="Visitors" data={data} summary={SUMMARY} bucket="day" />);
    expect(screen.getByText('This period')).toBeTruthy();
    expect(screen.getByText('Previous')).toBeTruthy();
    expect(container.querySelector('line[stroke="var(--fg-faint)"][stroke-dasharray]')).not.toBeNull();
  });
});

describe('LineChartPlot', () => {
  it('draws series 1 in var(--chart-1) and the compare line dashed in var(--fg-faint)', () => {
    const { container } = render(
      <LineChartPlot
        data={data}
        bucket="day"
        timeZone="UTC"
        format="count"
        area
        hasCompare
        seriesLabel="This period"
        compareLabel="Previous"
        higherIsBetter
      />
    );
    const curves = [...container.querySelectorAll('path.recharts-curve')];
    expect(curves.some((p) => p.getAttribute('stroke') === 'var(--chart-1)')).toBe(true);
    const compare = curves.find((p) => p.getAttribute('stroke') === 'var(--fg-faint)');
    expect(compare?.getAttribute('stroke-dasharray')).toBe('4 4');
    expect(container.querySelector('path[fill="var(--chart-1)"]')).not.toBeNull();
    // No hard-coded colours on the plot.
    expect(container.innerHTML).not.toMatch(/(stroke|fill)="#[0-9a-f]{3,6}"/i);
  });
});
