'use client';

// The heavy part of WorldMap: d3-geo + topojson-client + the world-atlas 110m
// shapes. Loaded only through WorldMap (next/dynamic), so all three land in one
// lazy chunk. Shapes are projected once per page load; data changes only
// change fills, and fills are CSS variables, so a theme switch repaints alone.
import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { geoEqualEarth, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import atlas from 'world-atlas/countries-110m.json';
import { countryName } from '@/shared/lib/block-values';
import { formatShare, formatValue } from '../charts/format';
import { featureAlpha2 } from './iso-codes';
import { bucketColor, bucketOf, type MapScale } from './scale';

export const MAP_W = 960;
export const MAP_H = 480;
const ANTARCTICA = '010';

type Shape = { key: string; code: string | null; d: string };

let shapes: Shape[] | null = null;

function getShapes(): Shape[] {
  if (shapes) return shapes;
  const topo = atlas as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const all = feature(topo, topo.objects.countries);
  const land = { ...all, features: all.features.filter((f) => f.id !== ANTARCTICA) };
  const path = geoPath(geoEqualEarth().fitExtent([[4, 4], [MAP_W - 4, MAP_H - 4]], land));
  shapes = land.features.map((f, i) => ({
    key: `${f.id ?? f.properties?.name ?? i}`,
    code: featureAlpha2(f.id, f.properties?.name),
    d: path(f) ?? '',
  }));
  return shapes;
}

export type WorldMapSvgProps = {
  /** Alpha-2 → value, already merged and upper-cased. */
  values: ReadonlyMap<string, number>;
  scale: MapScale;
  total: number;
  unit: readonly [singular: string, plural: string];
  summary: string;
  selected?: string | null;
  onSelect?: (country: string) => void;
};

/** Pointer position in the box, and which side of the pointer the tooltip sits on. */
type Hover = { code: string; x: number; y: number; width: number };

export function describeCountry(code: string, value: number, total: number, unit: readonly [string, string]): string {
  const name = countryName(code) ?? code;
  return `${name} · ${formatValue(value)} ${value === 1 ? unit[0] : unit[1]} · ${formatShare(value, total)}`;
}

export default function WorldMapSvg({ values, scale, total, unit, summary, selected, onSelect }: WorldMapSvgProps) {
  const all = getShapes();
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);

  const codeAt = (e: PointerEvent | MouseEvent): string | null => {
    const code = (e.target as Element).getAttribute?.('data-code');
    return code && (values.get(code) ?? 0) > 0 ? code : null;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'mouse') return;
    const code = codeAt(e);
    const box = boxRef.current?.getBoundingClientRect();
    if (!code || !box) return setHover(null);
    setHover({ code, x: e.clientX - box.left, y: e.clientY - box.top, width: box.width });
  };

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const code = codeAt(e);
    if (!code) return;
    setTapped(code);
    onSelect?.(code);
  };

  const selectedShapes = selected ? all.filter((s) => s.code === selected) : [];
  const caption = tapped ?? selected ?? null;
  const flip = hover ? hover.x > hover.width / 2 : false;

  return (
    <div className="relative">
      <div ref={boxRef} className="relative aspect-[2/1] w-full">
        <figure role="img" aria-label={summary} className="size-full">
          <svg
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            className="size-full"
            aria-hidden="true"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onClick={onClick}
          >
            {all.map((s) => {
              const value = s.code ? (values.get(s.code) ?? 0) : 0;
              const active = value > 0;
              return (
                <path
                  key={s.key}
                  d={s.d}
                  data-code={s.code ?? undefined}
                  fill={bucketColor(scale, bucketOf(scale, value))}
                  stroke="var(--edge-strong)"
                  strokeWidth={0.5}
                  vectorEffect="non-scaling-stroke"
                  className={active && onSelect ? 'cursor-pointer' : undefined}
                />
              );
            })}
            {selectedShapes.map((s) => (
              <path
                key={`sel-${s.key}`}
                d={s.d}
                fill="none"
                stroke="var(--fg)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ))}
          </svg>
        </figure>
        {hover && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-fg tabular-nums shadow-[var(--shadow-float)]"
            style={{
              top: hover.y + 12,
              left: flip ? undefined : hover.x + 12,
              right: flip ? hover.width - hover.x + 12 : undefined,
            }}
          >
            {describeCountry(hover.code, values.get(hover.code) ?? 0, total, unit)}
          </div>
        )}
      </div>
      {/* Touch has no hover: the last tapped country reads here instead. */}
      <p aria-hidden="true" className="mt-2 hidden min-h-4 text-xs text-fg-muted tabular-nums pointer-coarse:block">
        {caption && (values.get(caption) ?? 0) > 0
          ? describeCountry(caption, values.get(caption) ?? 0, total, unit)
          : 'Tap a country to see its numbers.'}
      </p>
    </div>
  );
}
