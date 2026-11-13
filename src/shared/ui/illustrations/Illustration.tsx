import type { ReactNode } from 'react';

/*
 * Shared frame for the admin state illustrations (T-14: inline SVG + CSS, 0 KB runtime).
 *
 * The CSS ships as a React 19 hoisted <style href precedence>: React puts it in <head>
 * once, however many illustrations render, and only on pages that render one. Public
 * routes never import an illustration, so they never pay for this CSS.
 *
 * Draw-in (motion row 14): every `Draw` path uses pathLength=1, so dasharray 1 + offset 1
 * hides it and the animation moves the offset to 0. Total ≤ 600 ms, then static.
 * Dots (`Dot`) fade in during the last 120 ms. `breathe` is motion row 15 (waiting).
 * Reduced motion: no animation, every path shows fully drawn.
 */
const CSS = `.sf-illus *{vector-effect:non-scaling-stroke}
.sf-illus .sf-draw{stroke-dasharray:1;stroke-dashoffset:1;animation:sf-draw 480ms var(--ease-out,cubic-bezier(.2,0,0,1)) forwards}
.sf-illus .sf-d1{animation-delay:60ms}.sf-illus .sf-d2{animation-delay:120ms}
.sf-illus .sf-fade{animation:sf-fade 120ms var(--ease-out,cubic-bezier(.2,0,0,1)) 480ms both}
.sf-illus .sf-breathe{animation:sf-fade 120ms var(--ease-out,cubic-bezier(.2,0,0,1)) 480ms both,sf-breathe 2.4s ease-in-out 600ms infinite}
@keyframes sf-draw{to{stroke-dashoffset:0}}
@keyframes sf-fade{from{opacity:0}}
@keyframes sf-breathe{50%{opacity:.5}}
@media (prefers-reduced-motion:reduce){.sf-illus *{animation:none!important;stroke-dashoffset:0!important}}`;

/** Decorative 160×120 frame. Lines use currentColor (`text-fg-faint`); the one accent is `--brand`. */
export default function Illustration({ children }: { children: ReactNode }) {
  return (
    <>
      <style href="sf-illustration" precedence="default">
        {CSS}
      </style>
      <svg
        viewBox="0 0 160 120"
        width="160"
        height="120"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="sf-illus text-fg-faint"
      >
        {children}
      </svg>
    </>
  );
}

/** A line that draws in once. `delay` staggers by 60 ms steps (total stays ≤ 600 ms). */
export function Draw({ d, delay, accent }: { d: string; delay?: 1 | 2; accent?: boolean }) {
  const cls = `sf-draw${delay ? ` sf-d${delay}` : ''}${accent ? ' stroke-brand' : ''}`;
  return <path d={d} pathLength={1} className={cls} />;
}

/** A dashed line. Dashes cannot also draw in (both use dasharray), so it fades in. */
export function Dashed({ d }: { d: string }) {
  return <path d={d} strokeDasharray="3 4" className="sf-fade" />;
}

/** The single brand accent dot. `breathe` = the waiting loop (motion row 15). */
export function Dot({ cx, cy, breathe }: { cx: number; cy: number; breathe?: boolean }) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      stroke="none"
      className={`fill-brand ${breathe ? 'sf-breathe' : 'sf-fade'}`}
    />
  );
}

/**
 * Faint grid of dots, `step` px apart, starting at (x0, y0). `skip(x, y)` leaves holes.
 * Static: it is the backdrop the lines draw over.
 */
export function DotGrid({
  cols,
  rows,
  x0,
  y0,
  step = 20,
  skip,
}: {
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  step?: number;
  skip?: (x: number, y: number) => boolean;
}) {
  const dots: ReactNode[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = x0 + i * step;
      const y = y0 + j * step;
      if (!skip?.(x, y)) dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={1.25} />);
    }
  }
  return (
    <g fill="currentColor" stroke="none" opacity={0.5}>
      {dots}
    </g>
  );
}
