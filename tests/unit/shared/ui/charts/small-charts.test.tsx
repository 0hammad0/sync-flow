import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BarList from '@/shared/ui/charts/BarList';
import Donut, { donutArcs } from '@/shared/ui/charts/Donut';
import Sparkline, { sparklinePath } from '@/shared/ui/charts/Sparkline';
import { formatBucketLabel, formatBucketTick, formatChange, formatDuration, formatTick } from '@/shared/ui/charts/format';

describe('BarList', () => {
  const items = [
    { label: '/pricing', value: 300, href: '/admin/pages?path=%2Fpricing' },
    { label: '/', value: 150 },
    { label: '/blog', value: 50 },
  ];

  it('is a real list with labels, values and shares; bars use var(--chart-1) and scale to the top row', () => {
    const { container } = render(<BarList items={items} showShare viewAllHref="/admin/pages" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(screen.getByText('/pricing')).toBeTruthy();
    expect(screen.getByText('300')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByRole('link', { name: /\/pricing/ }).getAttribute('href')).toBe('/admin/pages?path=%2Fpricing');
    expect(screen.getByRole('link', { name: 'View all' })).toBeTruthy();
    const bars = [...container.querySelectorAll<HTMLElement>('[aria-hidden="true"].absolute')];
    expect(bars.map((b) => b.style.width)).toEqual(['100%', '50%', '16.7%']);
    expect(bars[0].className).toContain('bg-chart-1/12');
  });

  it('caps rows at max and shows the empty state with no data', () => {
    render(<BarList items={items} max={2} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders the empty state when there are no rows', () => {
    render(<BarList items={[]} />);
    expect(screen.getByText('No visits in this range')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('Donut', () => {
  const parts = [
    { label: 'Desktop', value: 610 },
    { label: 'Mobile', value: 360 },
    { label: 'Tablet', value: 30 },
  ];

  it('has a sentence label and a text legend; parts are coloured by var(--chart-N) in fixed order', () => {
    const { container } = render(<Donut label="Devices" parts={parts} />);
    expect(screen.getByRole('img', { name: 'Devices: Desktop 61%, Mobile 36%, Tablet 3%' })).toBeTruthy();
    expect(screen.getByText('1,000')).toBeTruthy();
    expect(screen.getByText('Mobile')).toBeTruthy();
    expect(screen.getByText('360')).toBeTruthy();
    const strokes = [...container.querySelectorAll('circle')].map((c) => c.getAttribute('stroke'));
    expect(strokes).toEqual(['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)']);
  });

  it('leaves a 2 px gap between parts and skips zero parts', () => {
    const arcs = donutArcs([50, 0, 50]);
    expect(arcs.map((a) => a.index)).toEqual([0, 2]);
    const circ = 2 * Math.PI * 52;
    expect(arcs[0].length).toBeCloseTo(circ / 2 - 2);
    expect(arcs[1].offset).toBeCloseTo(circ / 2);
  });

  it('falls back to a BarList for more than 4 parts, and to the empty state for no data', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((label, i) => ({ label, value: i + 1 }));
    const { unmount } = render(<Donut label="Browsers" parts={five} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('img')).toBeNull();
    unmount();
    render(<Donut label="Devices" parts={[{ label: 'Desktop', value: 0 }]} />);
    expect(screen.getByText('No visits in this range')).toBeTruthy();
  });
});

describe('Sparkline', () => {
  it('draws one var(--chart-1) path and is hidden from screen readers', () => {
    const { container } = render(<Sparkline values={[1, 4, 2, 8]} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('path')).toHaveLength(1);
    expect(container.querySelector('path')!.getAttribute('stroke')).toBe('var(--chart-1)');
  });

  it('is a flat --edge line at the bottom when empty', () => {
    expect(sparklinePath([]).flat).toBe(true);
    expect(sparklinePath([0, 0, 0]).flat).toBe(true);
    const { container } = render(<Sparkline values={[0, 0]} />);
    expect(container.querySelector('path')!.getAttribute('stroke')).toBe('var(--edge)');
  });
});

describe('chart formats', () => {
  it('formats ticks, durations, changes and bucket dates', () => {
    expect(formatTick(1234)).toBe('1.2k');
    expect(formatTick(3_000_000)).toBe('3m');
    expect(formatDuration(83)).toBe('1m 23s');
    expect(formatDuration(3720)).toBe('1h 02m');
    expect(formatChange(1204, 1071)).toEqual({ text: '+12.4%', sign: 1 });
    expect(formatChange(90, 100)).toEqual({ text: '−10%', sign: -1 });
    expect(formatChange(5, 0)).toBeNull();
    const t = Date.UTC(2026, 10, 13, 14);
    expect(formatBucketTick(t, 'hour')).toBe('14:00');
    expect(formatBucketTick(t, 'day')).toBe('13 Nov');
    expect(formatBucketLabel(t, 'hour')).toBe('Fri 13 Nov, 14:00–15:00');
    expect(formatBucketLabel(Date.UTC(2026, 10, 13), 'day')).toBe('Fri 13 Nov 2026');
    expect(formatBucketLabel(Date.UTC(2026, 10, 9), 'week')).toBe('Week of 9 Nov 2026');
  });
});
