import type { ClickInput } from './tracker';
import type { Vitals } from './vitals';

/**
 * Click capture (phase 4), its own lazy chunk: the tracker chunk is at its
 * 2 KB budget, so this loads after the tracker starts (consent given, not
 * GPC / DNT, not /admin) and hands every event to the tracker's `click()`,
 * which queues it for the next flush (no write of its own, cap 300).
 *
 * - One `pointerup` listener on `document`, `{ passive: true, capture: true }`.
 * - Matches `a, button, [role=button], [data-track]` with `closest()`.
 * - Label: opt-in. Only an element that carries `data-track` itself gives its
 *   visible text (`textContent`, never `aria-label` or `innerText`), ≤ 40 chars;
 *   every other click has no label, so a link or button that shows user data
 *   (room names, codes, received URLs) can never leak. Still dropped inside
 *   `input, textarea, [contenteditable], [data-private]`.
 * - No layout reads per click: page width / height and the viewport width are
 *   read once per page view after idle and again on a debounced resize.
 * - Rage: ≥ 3 clicks within 600 ms within 30 px → one `rage` event per burst.
 * - Dead: no DOM change, navigation or focus loss within 1 s → `dead` event.
 *   One shared MutationObserver while any check is pending, then disconnected.
 *
 * Spec: docs/admin/01-architecture/07-tracker.md, 03-features/06-clicks.md.
 */

type Emit = (event: ClickInput) => void;

const MATCH = 'a, button, [role=button], [data-track]';
const PRIVATE = 'input, textarea, [contenteditable], [data-private]';
const RAGE_CLICKS = 3;
const RAGE_MS = 600;
const RAGE_PX = 30;
const DEAD_MS = 1000;
const RESIZE_MS = 500;
const TARGET_MAX = 120;
const LABEL_MAX = 40;
/** Selector depth for elements without `data-track`. */
const SELECTOR_DEPTH = 3;

// ---------------------------------------------------------------------------
// Pure parts (unit tested)

/** `data-track` id of the element or an ancestor, else a short CSS selector (tags and `:nth-of-type`, never ids or classes). */
export function targetOf(el: Element): string {
  const id = el.closest('[data-track]')?.getAttribute('data-track')?.trim();
  if (id) return id.slice(0, TARGET_MAX);
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < SELECTOR_DEPTH && node.localName !== 'body'; depth++) {
    let part = node.localName;
    const parent: Element | null = node.parentElement;
    if (parent) {
      let index = 0;
      let same = 0;
      for (const child of parent.children) {
        if (child.localName !== part) continue;
        same++;
        if (child === node) index = same;
      }
      if (same > 1) part += `:nth-of-type(${index})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ').slice(0, TARGET_MAX);
}

/**
 * Visible text of a clicked element that carries `data-track` itself, ≤ 40
 * chars. `null` for every other element (labels are opt-in: text on public
 * pages can be user data), and when the click was inside (or the element
 * holds) an input, textarea, contenteditable or `[data-private]` region.
 */
export function labelOf(el: Element, from: Element): string | null {
  if (!el.hasAttribute('data-track') || from.closest(PRIVATE) || el.closest(PRIVATE) || el.querySelector(PRIVATE)) return null;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX).trim();
  return text || null;
}

export type Tap = { t: number; x: number; y: number };

/**
 * Rage detector. Feed every click; returns true once per burst, on the click
 * that makes ≥ 3 clicks within 600 ms and within 30 px of the latest one.
 */
export function rageDetector(): (tap: Tap) => boolean {
  let recent: Tap[] = [];
  let burst = false;
  return (tap) => {
    recent = recent.filter((p) => tap.t - p.t <= RAGE_MS && Math.hypot(p.x - tap.x, p.y - tap.y) <= RAGE_PX);
    recent.push(tap);
    if (recent.length < RAGE_CLICKS) {
      burst = false;
      return false;
    }
    if (burst) return false;
    burst = true;
    return true;
  };
}

/** `sm` < 640, `md` < 1024, `lg` ≥ 1024 (CSS px of the viewport). */
export function vwBucket(width: number): 'sm' | 'md' | 'lg' {
  return width < 640 ? 'sm' : width < 1024 ? 'md' : 'lg';
}

// ---------------------------------------------------------------------------
// Dead clicks: one MutationObserver shared by every pending check

let observer: MutationObserver | null = null;
let pending = 0;
let changedAt = -1;

/**
 * Calls `onDead` if, 1 s after now, nothing changed: no DOM mutation, same
 * URL, the page still has focus (a file picker or a new tab takes it) and is
 * visible. The observer runs only while a check is pending.
 */
export function checkDead(onDead: () => void, ms = DEAD_MS): void {
  const at = Date.now();
  const href = location.href;
  if (!pending++) {
    observer = new MutationObserver(() => {
      changedAt = Date.now();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  setTimeout(() => {
    try {
      // Mutation callbacks are microtasks, so any change before this timer has been seen.
      const quiet = changedAt < at && location.href === href && document.hasFocus() && document.visibilityState === 'visible';
      if (!--pending) {
        observer?.disconnect();
        observer = null;
      }
      if (quiet) onDead();
    } catch {
      // Never reaches the page.
    }
  }, ms);
}

// ---------------------------------------------------------------------------
// Capture

let emit: Emit | null = null;
let width = 0;
let height = 0;
let viewport = 0;
let measuredPath: string | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
const rage = rageDetector();
/** Targets with a dead check running (one check per target at a time). */
const deadPending = new Set<string>();

/** The only layout reads: once per page view after idle, and after a resize settles. */
function measure(): void {
  try {
    const root = document.documentElement;
    width = root.scrollWidth;
    height = root.scrollHeight;
    viewport = innerWidth;
    measuredPath = location.pathname;
  } catch {
    // ignore
  }
}

function whenIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 200);
}

function onPointerUp(event: Event): void {
  try {
    const e = event as PointerEvent;
    if (!emit || e.button > 0 || e.isPrimary === false) return;
    const from = e.target instanceof Element ? e.target : null;
    const el = from?.closest(MATCH);
    if (!from || !el) return;
    // A new page view since the last measure: use the old numbers for this
    // click, re-measure after idle (never a synchronous layout read here).
    if (measuredPath !== location.pathname) {
      measuredPath = location.pathname;
      whenIdle(measure);
    }
    const target = targetOf(el);
    const base = {
      t: Date.now(),
      path: '',
      target,
      label: labelOf(el, from),
      x_pct: width > 0 ? Math.min(100, Math.max(0, Math.round((e.pageX / width) * 1000) / 10)) : 0,
      y: Math.max(0, Math.round(e.pageY)),
      doc_h: Math.max(0, Math.round(height)),
      vw_bucket: vwBucket(viewport || width),
    };
    const send = emit;
    send({ type: 'click', ...base });
    if (rage({ t: base.t, x: e.pageX, y: e.pageY })) send({ type: 'rage', ...base });
    // Links that open elsewhere or download never change this page.
    if (!deadPending.has(target) && !el.matches('a[download], a[target]:not([target="_self"])')) {
      deadPending.add(target);
      checkDead(() => send({ type: 'dead', ...base, t: Date.now() }));
      setTimeout(() => deadPending.delete(target), DEAD_MS);
    }
  } catch {
    // A tracker error must never reach the page.
  }
}

/**
 * Loads `web-vitals` for a sampled session. Lives here, not in the tracker,
 * so the tracker chunk carries one lazy-chunk stub instead of two (2 KB budget).
 */
export function vitals(onChange: (latest: Vitals) => void): void {
  import('./vitals')
    .then((m) => m.watchVitals(onChange))
    .catch(() => {});
}

/** Starts capture. Called once by the tracker with its `click()`. */
export function watch(record: Emit): void {
  if (emit) return;
  emit = record;
  // The tracker itself loaded after idle, so this first read is off the critical path.
  measure();
  addEventListener(
    'resize',
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(measure, RESIZE_MS);
    },
    { passive: true },
  );
  document.addEventListener('pointerup', onPointerUp, { passive: true, capture: true });
}
