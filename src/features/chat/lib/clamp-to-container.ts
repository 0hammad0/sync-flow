'use client';

// Keeps a floating element (popover, menu, tooltip) fully inside the area it
// can actually paint in: the viewport intersected with every ancestor that
// clips overflow (in the chat room that is the `[data-chat-scroll]` message
// list, whose `overflow-y: auto` clips both axes, and the chat panel card).
// The window is NOT the right bound: the chat panel is a centered card
// narrower than the window, so anything past its edge is cut off.
//
// What it does, in order:
//   1. caps max-width to the visible box minus `gap` on each side (never
//      loosens a smaller max-width the element already has in CSS);
//   2. flips to the other side of its anchor when the preferred side is
//      too short; if neither side fits, keeps the roomier side, caps
//      max-height to the box (the element then scrolls) and lets step 3
//      slide it over the anchor;
//   3. shifts it into the box with the standalone `translate` property, so
//      it composes with entrance animations that use `transform`.
//
// The element must be `position: absolute` and anchored to its containing
// block with `bottom: 100%` (placement 'above') or `top: 100%` ('below').

import { useLayoutEffect, type RefObject } from 'react';

export const CLAMP_GAP_PX = 8;

export interface ClampOptions {
  /** Minimum distance to every edge of the visible box, in px. */
  gap?: number;
  /** Which side of the anchor the element sits on in its CSS. */
  placement?: 'above' | 'below';
  /** Space between anchor and element when flipped (CSS length). */
  flipOffset?: string;
}

interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

function establishesAbsCb(cs: CSSStyleDeclaration): boolean {
  return (
    cs.position !== 'static' ||
    cs.transform !== 'none' ||
    cs.translate !== 'none' ||
    cs.scale !== 'none' ||
    cs.rotate !== 'none' ||
    cs.filter !== 'none' ||
    cs.perspective !== 'none' ||
    /paint|layout|strict|content/.test(cs.contain)
  );
}

/**
 * The box `el` can paint in: viewport ∩ the padding box (minus scrollbars)
 * of every ancestor that clips it. An absolutely positioned element escapes
 * clipping ancestors that sit between it and its containing block, so those
 * are skipped.
 */
export function visibleBox(el: HTMLElement): { box: Box; clipper: HTMLElement | null } {
  const de = document.documentElement;
  const box: Box = { top: 0, left: 0, right: de.clientWidth, bottom: de.clientHeight };
  let clipper: HTMLElement | null = null;
  let position = getComputedStyle(el).position;
  if (position === 'fixed') return { box, clipper };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    const isCb = position !== 'absolute' || establishesAbsCb(cs);
    if (isCb && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
      const r = p.getBoundingClientRect();
      const left = r.left + p.clientLeft;
      const top = r.top + p.clientTop;
      box.left = Math.max(box.left, left);
      box.top = Math.max(box.top, top);
      box.right = Math.min(box.right, left + p.clientWidth);
      box.bottom = Math.min(box.bottom, top + p.clientHeight);
      clipper ??= p;
    }
    if (isCb) {
      position = cs.position;
      if (position === 'fixed') break;
    }
  }
  return { box, clipper };
}

// Layout (untransformed) rect, so a mid-animation scale doesn't skew the
// measurement: the containing block's padding box plus the element's used
// insets, margins and size (all fractional, unlike offsetLeft/offsetWidth).
function layoutRect(el: HTMLElement): Box {
  const parent = el.offsetParent as HTMLElement | null;
  const cs = getComputedStyle(el);
  if (!parent || cs.position !== 'absolute') return el.getBoundingClientRect();
  const pr = parent.getBoundingClientRect();
  const left = pr.left + parent.clientLeft + parseFloat(cs.left) + parseFloat(cs.marginLeft);
  const top = pr.top + parent.clientTop + parseFloat(cs.top) + parseFloat(cs.marginTop);
  return { left, top, right: left + parseFloat(cs.width), bottom: top + parseFloat(cs.height) };
}

// The element's own CSS max size in px (Infinity for none / non-px values).
function cssMax(value: string): number {
  return value.endsWith('px') ? parseFloat(value) : Infinity;
}

/** One-shot clamp. Safe to call repeatedly; it resets its own styles first. */
export function clampToContainer(el: HTMLElement | null, options: ClampOptions = {}): void {
  // Hidden (display: none) — nothing to measure.
  if (!el || !el.offsetParent) return;
  const { gap = CLAMP_GAP_PX, placement = 'above', flipOffset = '0.25rem' } = options;
  const s = el.style;
  s.translate = '';
  s.maxWidth = '';
  s.maxHeight = '';
  s.top = '';
  s.bottom = '';
  s.overflowY = '';

  const { box } = visibleBox(el);
  const cs = getComputedStyle(el);
  const availW = Math.max(0, box.right - box.left - 2 * gap);
  const ownMaxW = cssMax(cs.maxWidth);
  if (availW < ownMaxW) s.maxWidth = `${availW}px`;
  const ownMaxH = cssMax(cs.maxHeight);

  // Vertical: preferred side, else the other side, else the roomier one
  // with a capped height.
  const flip = () => {
    if (placement === 'above') {
      s.bottom = 'auto';
      s.top = `calc(100% + ${flipOffset})`;
    } else {
      s.top = 'auto';
      s.bottom = `calc(100% + ${flipOffset})`;
    }
  };
  // Space on each side, measured from the element's edge nearest the
  // anchor (that edge stays put while its height changes).
  const space = (r: Box, side: 'above' | 'below') =>
    side === 'above' ? r.bottom - (box.top + gap) : box.bottom - gap - r.top;
  let r = layoutRect(el);
  const height = r.bottom - r.top;
  const preferred = space(r, placement);
  if (height > preferred) {
    flip();
    const other = space(layoutRect(el), placement === 'above' ? 'below' : 'above');
    if (height > other) {
      // Neither side fits: keep the roomier side, cap the height to the
      // box, and let the vertical shift below slide it over the anchor.
      if (preferred >= other) {
        s.top = '';
        s.bottom = '';
      }
      const boxH = Math.max(0, box.bottom - box.top - 2 * gap);
      if (height > boxH) {
        s.maxHeight = `${Math.min(boxH, ownMaxH)}px`;
        // Scroll whatever doesn't fit (an inner scroller like the emoji
        // grid shrinks first when the element is a flex column).
        s.overflowY = 'auto';
      }
    }
    r = layoutRect(el);
  }

  // Shift into the box: horizontally always, vertically only in the
  // neither-side-fits case above (otherwise it already fits).
  const shift = (start: number, end: number, min: number, max: number) =>
    start < min ? min - start : end > max ? Math.max(max - end, min - start) : 0;
  const dx = shift(r.left, r.right, box.left + gap, box.right - gap);
  const dy = shift(r.top, r.bottom, box.top + gap, box.bottom - gap);
  if (dx !== 0 || dy !== 0) s.translate = `${dx}px ${dy}px`;
}

/**
 * Clamp `ref` while `active`, re-clamping before paint whenever
 * `contentKey` changes (e.g. quick bar → full emoji grid), and on window
 * resize, scroll, and size changes of the element or its clipping box.
 */
export function useClampToContainer(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  contentKey?: unknown,
  options?: ClampOptions
): void {
  const gap = options?.gap;
  const placement = options?.placement;
  const flipOffset = options?.flipOffset;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const opts = { gap, placement, flipOffset };
    clampToContainer(el, opts);

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => clampToContainer(el, opts));
    };
    // Scrolling inside the element itself (a capped emoji grid) must not
    // re-clamp: the reset would briefly uncap it and lose its scroll spot.
    const onScroll = (e: Event) => {
      if (!el.contains(e.target as Node)) schedule();
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const { clipper } = visibleBox(el);
    if (clipper) ro.observe(clipper);
    window.addEventListener('resize', schedule);
    // Capture: scrolls of the message list don't bubble to window.
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [ref, active, contentKey, gap, placement, flipOffset]);
}
