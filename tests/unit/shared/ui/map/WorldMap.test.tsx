import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorldMap from '@/shared/ui/map/WorldMap';
import WorldMapSvg, { describeCountry } from '@/shared/ui/map/WorldMapSvg';
import { alpha2ToNumeric, featureAlpha2, numericToAlpha2 } from '@/shared/ui/map/iso-codes';
import { bucketColor, bucketOf, buildScale, legendItems } from '@/shared/ui/map/scale';

describe('ISO 3166-1 alpha-2 ↔ numeric', () => {
  it('maps both ways, case-insensitive, with leading zeros', () => {
    expect(alpha2ToNumeric('PK')).toBe('586');
    expect(alpha2ToNumeric('us')).toBe('840');
    expect(alpha2ToNumeric('AF')).toBe('004');
    expect(numericToAlpha2('586')).toBe('PK');
    expect(numericToAlpha2(4)).toBe('AF');
    expect(alpha2ToNumeric('ZZ')).toBeNull();
    expect(numericToAlpha2('999')).toBeNull();
  });

  it('covers every country shape in world-atlas 110m', () => {
    const atlas = JSON.parse(readFileSync('node_modules/world-atlas/countries-110m.json', 'utf8')) as {
      objects: { countries: { geometries: { id?: string; properties: { name: string } }[] } };
    };
    const missing = atlas.objects.countries.geometries
      .filter((g) => !featureAlpha2(g.id, g.properties.name))
      .map((g) => g.properties.name);
    expect(missing).toEqual([]);
    expect(featureAlpha2(undefined, 'Kosovo')).toBe('XK');
  });
});

describe('map scale', () => {
  it('builds up to 6 quantile buckets over values ≥ 1 and colours them with --seq-*', () => {
    const scale = buildScale([0, 1, 2, 5, 9, 10, 20, 50, 80, 200, 500, 1204, 3000])!;
    expect(scale.lowers.length).toBe(6);
    expect(bucketOf(scale, 0)).toBe(-1);
    expect(bucketColor(scale, -1)).toBe('var(--surface-2)');
    expect(bucketColor(scale, 0)).toBe('var(--seq-1)');
    expect(bucketColor(scale, bucketOf(scale, 3000))).toBe('var(--seq-6)');
    const legend = legendItems(scale);
    expect(legend[0].label).toBe('1–4');
    expect(legend.at(-1)!.label).toBe('1,204–3,000');
  });

  it('spreads fewer buckets over the whole ramp and returns null with no data', () => {
    const one = buildScale([7, 7, 7])!;
    expect(one.lowers).toEqual([7]);
    expect(bucketColor(one, 0)).toBe('var(--seq-6)');
    expect(buildScale([0, 0])).toBeNull();
  });
});

describe('WorldMap', () => {
  const data = [
    { country: 'PK', value: 1204 },
    { country: 'US', value: 900 },
    { country: 'IN', value: 40 },
  ];

  it('shows the empty state when no country has visitors', () => {
    render(<WorldMap data={[]} summary="No locations." />);
    expect(screen.getByText('No locations yet')).toBeTruthy();
    expect(screen.getByText('Locations come from visits. None in this range.')).toBeTruthy();
  });

  it('lazy-loads the map with the summary as its label, and shows a legend with ranges', async () => {
    render(<WorldMap data={data} summary="Top countries: Pakistan 56%, United States 42%, India 2%" />);
    expect(screen.getByRole('list', { name: 'Visitors per country' })).toBeTruthy();
    expect(await screen.findByRole('img', { name: /^Top countries: Pakistan 56%/ }, { timeout: 5000 })).toBeTruthy();
  });
});

describe('WorldMapSvg', () => {
  const values = new Map([
    ['PK', 1204],
    ['US', 900],
  ]);
  const scale = buildScale([...values.values()])!;

  it('fills countries from --seq-* variables, zero countries with --surface-2, and calls onSelect with alpha-2', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <WorldMapSvg
        values={values}
        scale={scale}
        total={2104}
        unit={['visitor', 'visitors']}
        summary="Top countries"
        selected="US"
        onSelect={onSelect}
      />
    );
    const pk = container.querySelector('path[data-code="PK"]')!;
    expect(pk.getAttribute('fill')).toMatch(/^var\(--seq-[1-6]\)$/);
    expect(container.querySelector('path[data-code="FR"]')!.getAttribute('fill')).toBe('var(--surface-2)');
    expect(container.querySelector('path[data-code="AQ"]')).toBeNull();
    expect(container.querySelector('path[stroke="var(--fg)"]')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/fill="#[0-9a-f]{3,6}"/i);

    fireEvent.click(pk);
    expect(onSelect).toHaveBeenCalledWith('PK');
    fireEvent.click(container.querySelector('path[data-code="FR"]')!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('describes a country with name, count and share', () => {
    expect(describeCountry('PK', 1204, 5145, ['visitor', 'visitors'])).toBe('Pakistan · 1,204 visitors · 23.4%');
    expect(describeCountry('PK', 1, 4, ['visitor', 'visitors'])).toBe('Pakistan · 1 visitor · 25%');
  });
});
