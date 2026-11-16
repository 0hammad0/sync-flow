'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import ErrorState from '@/shared/ui/ErrorState';
import SegmentedControl from '@/shared/ui/SegmentedControl';
import Spinner from '@/shared/ui/Spinner';
import { formatNumber } from '@/features/admin/format';
import { MAP_MAX_HEIGHT, MAP_MODES, VW_LABELS, type MapMode } from '../constants';
import type { ClickPointDto } from '../types';
import type { ClickMapProps } from './ClickMap';
import ElementRanking from './ElementRanking';

// Click map (06-clicks.md "How the map works"), a lazy chunk:
// 1. the real page in a same-origin iframe at the bucket's width
//    (`?sf_preview=1`: the loader never starts the tracker in it), scaled to fit;
// 2. a canvas of the same size draws one dot per click (x = x% × width,
//    y scaled by frame height / stored doc_h when they differ by > 10%);
// 3. a second canvas draws only the hovered / pinned target's dots.
// The iframe is inert: sandboxed, no pointer events, out of the tab order.

const SETTLE_MS = 300;
const LOAD_TIMEOUT_MS = 15_000;
const DOT_RADIUS = 4;
const HEAT_RADIUS = 12;
const HEAT_ALPHA = 0.08;

type Size = { width: number; height: number };

/** y of a dot on a frame `frameH` tall; dots of a page that changed > 30% are drawn faint. */
export function placeDot(p: ClickPointDto, width: number, frameH: number): { x: number; y: number; faint: boolean } {
  const drift = p.docH > 0 ? Math.abs(frameH - p.docH) / p.docH : 0;
  const y = p.docH > 0 && drift > 0.1 ? (p.y * frameH) / p.docH : p.y;
  return { x: p.x * width, y, faint: drift > 0.3 };
}

/** Resolves a CSS colour token to a value the canvas understands. */
function tokenColor(el: HTMLElement, className: string): string {
  const probe = document.createElement('span');
  probe.className = className;
  el.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || '#0f766e';
}

function draw(canvas: HTMLCanvasElement, points: readonly ClickPointDto[], size: Size, mode: MapMode, highlight: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, size.width, size.height);
  const brand = tokenColor(canvas.parentElement ?? document.body, 'text-brand');
  const warn = tokenColor(canvas.parentElement ?? document.body, 'text-warning');
  for (const p of points) {
    const { x, y, faint } = placeDot(p, size.width, size.height);
    if (y > size.height) continue;
    ctx.beginPath();
    if (mode === 'heat' && !highlight) {
      ctx.globalAlpha = HEAT_ALPHA * (faint ? 0.5 : 1);
      ctx.fillStyle = p.rage ? warn : brand;
      ctx.arc(x, y, HEAT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.globalAlpha = (highlight ? 1 : 0.7) * (faint ? 0.5 : 1);
    ctx.fillStyle = p.rage ? warn : brand;
    ctx.arc(x, y, highlight ? DOT_RADIUS + 2 : DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    if (p.rage || p.dead || highlight) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = highlight ? '#ffffff' : warn;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

export default function ClickMapOverlay({ path, vw, mode: initialMode, points, targets }: ClickMapProps) {
  const frameWidth = VW_LABELS[vw].width;
  const [mode, setMode] = useQueryState('mode', parseAsStringLiteral(MAP_MODES).withDefault(initialMode));
  const [boxWidth, setBoxWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(VW_LABELS[vw].height);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const active = pinned ?? hover;

  const src = `${path}?sf_preview=1`;
  const scale = boxWidth > 0 ? Math.min(1, boxWidth / frameWidth) : 1;
  const size = useMemo<Size>(() => ({ width: frameWidth, height: Math.min(frameHeight, MAP_MAX_HEIGHT) }), [frameWidth, frameHeight]);

  // Fit the frame to the box.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // The page re-mounts this for a new path or viewport (keyed Suspense), so one timeout covers a load.
  useEffect(() => {
    const timer = setTimeout(() => setState((s) => (s === 'loading' ? 'failed' : s)), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const onLoad = useCallback(() => {
    // Dots only after the page settles (late fonts, lazy content).
    setTimeout(() => {
      try {
        const doc = frameRef.current?.contentDocument;
        const height = doc?.documentElement.scrollHeight ?? 0;
        if (height > 0) setFrameHeight(height);
        setState('ready');
      } catch {
        setState('failed');
      }
    }, SETTLE_MS);
  }, []);

  // Base layer: once per data load (and on mode / size change).
  useEffect(() => {
    if (state !== 'ready' || !baseRef.current) return;
    const frame = requestAnimationFrame(() => baseRef.current && draw(baseRef.current, points, size, mode, false));
    return () => cancelAnimationFrame(frame);
  }, [state, points, size, mode]);

  // Highlight layer: only the hovered / pinned target's dots.
  useEffect(() => {
    const canvas = topRef.current;
    if (state !== 'ready' || !canvas) return;
    const frame = requestAnimationFrame(() => {
      const chosen = active === null ? [] : points.filter((p) => p.target === active);
      draw(canvas, chosen, size, 'dots', true);
      const first = chosen[0];
      // Bring the highlighted area into view.
      if (first && boxRef.current) {
        const { y } = placeDot(first, size.width, size.height);
        boxRef.current.scrollTo({ top: Math.max(0, y * scale - 120), behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [state, active, points, size, scale]);

  const clicks = points.filter((p) => !p.rage && !p.dead).length;
  const rage = points.filter((p) => p.rage).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-xs text-fg-muted">You see the page as you, signed in. Visitors may see a different layout.</p>
        {state === 'failed' ? (
          <div className="rounded-lg border border-edge bg-surface p-4">
            <ErrorState size="inline" title="Could not load the page preview." reason="The list still works." />
          </div>
        ) : (
          <div ref={boxRef} className="relative h-[60vh] min-h-80 overflow-auto rounded-lg border border-edge bg-surface-2">
            {state === 'loading' && (
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs text-fg-muted shadow-sm">
                <Spinner size={12} />
                <span role="status">Loading page…</span>
              </div>
            )}
            <div style={{ width: size.width * scale, height: size.height * scale }} className="relative">
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
              >
                <iframe
                  ref={frameRef}
                  key={src}
                  src={src}
                  title={`Preview of ${path}`}
                  sandbox="allow-same-origin allow-scripts"
                  loading="lazy"
                  tabIndex={-1}
                  onLoad={onLoad}
                  onError={() => setState('failed')}
                  className="pointer-events-none absolute inset-0 border-0 bg-canvas"
                  style={{ width: size.width, height: size.height }}
                />
                <canvas
                  ref={baseRef}
                  aria-hidden="true"
                  width={size.width}
                  height={size.height}
                  className={`pointer-events-none absolute inset-0 transition-opacity ${active !== null ? 'opacity-20' : ''}`}
                />
                <canvas
                  ref={topRef}
                  aria-hidden="true"
                  width={size.width}
                  height={size.height}
                  className="pointer-events-none absolute inset-0"
                />
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted tabular-nums">
          <SegmentedControl
            label="Map style"
            size="sm"
            value={mode}
            onValueChange={(next) => void setMode(next === 'dots' ? null : next)}
            items={[
              { value: 'dots', label: 'Dots' },
              { value: 'heat', label: 'Heat' },
            ]}
          />
          <span>
            {formatNumber(clicks)} {clicks === 1 ? 'click' : 'clicks'} · {formatNumber(rage)} rage
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <h2 className="mb-2 text-sm font-semibold text-fg">Top elements</h2>
        <ElementRanking
          rows={targets}
          path={path}
          vw={vw}
          compact
          active={active}
          onHover={setHover}
          onPin={(i) => setPinned((p) => (p === i ? null : i))}
        />
      </div>
    </div>
  );
}
