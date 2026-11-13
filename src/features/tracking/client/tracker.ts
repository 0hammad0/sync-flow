import type { BeaconInput, TrackerEventInput } from '../schemas';
import { gate, readState } from './consent';
import { pagePath } from './page-path';
import type { Vitals } from './vitals';

/**
 * First-party tracker (phase 2). Loaded by `loader.ts` after the page is idle,
 * as its own chunk (< 2 KB gz). No libraries; `web-vitals` is a separate,
 * dynamic chunk for 1 in 10 sessions.
 *
 * - Events stay in memory. One flush = one POST to `/api/e` = one Firestore
 *   write: on `visibilitychange → hidden`, on `pagehide` (`final: true`), and
 *   a checkpoint every 60 s while visible. Never per event, never `unload`.
 *   A checkpoint with nothing new sends nothing.
 * - `sendBeacon`, falling back to `fetch(…, { keepalive: true })`.
 * - Session id: 16 random bytes in `sessionStorage` (per tab, no cookie).
 *   A final flush ends the session (the server rolls it up then), so the next
 *   page load in the tab, or a back/forward-cache restore, starts a new one.
 * - Caps: 100 pages and 300 clicks per session (counts in `sessionStorage`).
 * - Never sent: typed text, messages, file names, room codes or tokens
 *   (paths are masked here, before they leave the browser), query strings
 *   other than `utm_*`, the referrer beyond its host.
 * - Every entry point is wrapped in try/catch: an error never reaches the page.
 * - Listeners are added once and do nothing while stopped (smaller than
 *   removing them; `stop()` is rare).
 *
 * Spec: docs/admin/01-architecture/07-tracker.md, 05-performance-budget.md.
 */

// Not exported: every export of a dynamically imported chunk is kept, and
// bytes count here. tests/unit/tracking/tracker.test.ts uses the same numbers.
const ENDPOINT = '/api/e';
const CHECKPOINT_MS = 60_000;
/** Engaged time pauses after this long without input. */
const IDLE_MS = 30_000;
const MAX_PAGES = 100;
const MAX_CLICKS = 300;
/** Flush early at this many queued events (the server takes at most 50 per flush). */
const EARLY_FLUSH_EVENTS = 40;
const VITALS_SAMPLE_RATE = 0.1;
const STORAGE_KEY = 'sf_s';
const MAX_ENGAGE_MS = 60 * 60_000;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

/** Per-tab session state, kept in `sessionStorage`. */
type Session = {
  /** Session id, 32 hex characters. */
  i: string;
  /** Next flush number. */
  q: number;
  /** Page views counted (cap 100). Also the source of page-view ids. */
  p: number;
  /** Clicks counted (cap 300, phase 4). */
  c: number;
  /** 1 = this session reports Web Vitals. */
  v: number;
};

type PageviewInput = Extract<TrackerEventInput, { type: 'pageview' }>;

const OFF = 0;
const STARTING = 1;
const ON = 2;
let phase = OFF;
let listening = false;
let s: Session;
let queue: TrackerEventInput[] = [];
/** Current page view id; null on a page we do not record. */
let pv: string | null = null;
let lastPv: string | null = null;
let lastRaw: string | null = null;
let ms = 0;
let scroll: 0 | 25 | 50 | 75 | 100 = 0;
let scrollSent = 0;
/** Start of the current engaged stretch; null while hidden. */
let mark: number | null = null;
let lastInput = 0;
let scrollPending = false;
/** Latest Web Vitals of a sampled session, until sent. */
let vitals: Vitals | null = null;
let watchingVitals = false;

const now = () => Date.now();
const visible = () => document.visibilityState === 'visible';

/** Runs `fn` only while the tracker is on, and swallows any error. */
function guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    try {
      if (phase === ON) fn(...args);
    } catch {
      // A tracker error must never reach the page.
    }
  };
}

/** Session id: a random UUID without dashes = 32 hex characters (122 random bits, from the CSPRNG). */
function newSession(): Session {
  return { i: crypto.randomUUID().replaceAll('-', ''), q: 0, p: 0, c: 0, v: Math.random() < VITALS_SAMPLE_RATE ? 1 : 0 };
}

/** Saves the session, or with `forget` removes it. Storage blocked (private mode): the session lives in memory. */
function save(forget?: boolean): void {
  try {
    if (forget) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

function loadSession(): Session {
  try {
    const old = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!) as Session;
    if (/^[0-9a-f]{32}$/.test(old.i)) return old;
  } catch {
    // Missing or unreadable: start fresh.
  }
  return newSession();
}

/** Adds visible, non-idle time since `mark` to the current page. */
function account(t = now()): void {
  if (mark === null) return;
  const end = Math.min(t, lastInput + IDLE_MS);
  if (pv && end > mark) ms += end - mark;
  mark = t;
}

function pushEngage(force?: boolean): void {
  const id = pv ?? (force ? lastPv : null);
  if (!id || (!force && !ms && scroll === scrollSent)) return;
  queue.push({ type: 'engage', t: now(), pv: id, ms: Math.min(ms, MAX_ENGAGE_MS), scroll }); // whole ms: Date.now() differences
  ms = 0;
  scrollSent = scroll;
}

function pageview(raw: string): void {
  if (raw === lastRaw) return;
  lastRaw = raw;
  const t = now();
  account(t);
  pushEngage();
  pv = null;
  scroll = scrollSent = 0;
  const path = pagePath(raw);
  if (!path || s.p >= MAX_PAGES) return;
  pv = lastPv = (++s.p).toString(36);
  const event: PageviewInput = { type: 'pageview', t, pv, path, vw: innerWidth, vh: innerHeight };
  if (s.p === 1) {
    // Landing page of the session only: the referrer's host (never its path or
    // query) and utm_* (nothing else from the query string). The server re-checks both.
    try {
      const ref = new URL(document.referrer).hostname;
      if (ref !== location.hostname) event.ref = ref;
    } catch {
      // No referrer.
    }
    const query = new URLSearchParams(location.search);
    for (const key of UTM_KEYS) {
      const value = query.get(key)?.trim().slice(0, 100);
      if (value) event[key] = value;
    }
  }
  queue.push(event);
  save();
  if (queue.length >= EARLY_FLUSH_EVENTS) flush();
}

function send(body: string): void {
  try {
    if (navigator.sendBeacon(ENDPOINT, body)) return;
  } catch {
    // fall through to fetch
  }
  fetch(ENDPOINT, { method: 'POST', body, keepalive: true }).catch(() => {});
}

/** One flush = one POST = one Firestore write. Sends nothing when there is nothing new (except a final flush). */
const flush = guard((final?: boolean) => {
  // Rejected from Privacy choices, or tracking switched off (`/api/e` set sf_cr=off): stop, send nothing.
  if (gate(readState()) === 'stop') return stop();
  account();
  pushEngage(final && !queue.length);
  if (vitals) {
    queue.push({ type: 'vitals', t: now(), ...vitals });
    vitals = null;
  }
  while (queue.length) {
    const beacon: BeaconInput = { sid: s.i, seq: s.q++, events: queue.splice(0, 50) };
    if (final && !queue.length) beacon.final = true;
    send(JSON.stringify(beacon));
  }
  save(final);
});

const onInput = guard(() => {
  const t = now();
  account(t);
  lastInput = t;
  if (mark === null && visible()) mark = t;
});

const measureScroll = guard(() => {
  scrollPending = false;
  const range = document.documentElement.scrollHeight - innerHeight;
  // Quarter buckets: 0, 25, 50, 75, 100 (a page that does not scroll counts as fully seen).
  const bucket = (Math.min(4, range > 0 ? Math.floor((scrollY / range) * 4) : 4) * 25) as typeof scroll;
  if (bucket > scroll) scroll = bucket;
});

const HANDLERS: [EventTarget, string, (event: Event) => void][] = [
  [
    document,
    'visibilitychange',
    guard(() => {
      if (visible()) mark = lastInput = now();
      else {
        flush();
        mark = null;
      }
    }),
  ],
  // The page is going away (or into the back/forward cache, where `pageshow` starts a new session).
  [window, 'pagehide', () => flush(true)],
  [
    window,
    'pageshow',
    guard((event: Event) => {
      if (!(event as PageTransitionEvent).persisted) return;
      // Restored from the back/forward cache: the old session already sent its final flush.
      begin(newSession());
    }),
  ],
  [document, 'pointerdown', onInput],
  [document, 'keydown', onInput],
  [
    document,
    'scroll',
    guard(() => {
      onInput();
      if (!scrollPending) {
        scrollPending = true;
        requestAnimationFrame(measureScroll);
      }
    }),
  ],
];

/** 1 in 10 sessions: loads `web-vitals` (own chunk); the latest values ride on the next flush. */
function loadVitals(): void {
  if (watchingVitals) return;
  watchingVitals = true;
  import('./vitals')
    .then((m) => m.watchVitals((latest) => (vitals = latest)))
    .catch(() => {});
}

/** (Re)starts recording with `session`: listeners once, checkpoint timer once, first page view. */
function begin(session: Session): void {
  phase = ON;
  s = session;
  queue = [];
  pv = lastPv = lastRaw = null;
  ms = 0;
  lastInput = now();
  mark = visible() ? lastInput : null;
  if (!listening) {
    listening = true;
    for (const [target, type, fn] of HANDLERS) target.addEventListener(type, fn, { passive: true, capture: true });
    setInterval(
      guard(() => visible() && flush()),
      CHECKPOINT_MS,
    );
  }
  save();
  pageview(location.pathname);
  if (s.v) loadVitals();
}

/** Decides whether to run: GPC/DNT, stored choice, region (probing `/api/e` once), banner. */
async function decide(): Promise<boolean> {
  let g = gate(readState());
  if (g === 'probe') {
    await fetch(ENDPOINT);
    g = gate(readState());
  }
  if (g === 'ask') g = (await (await import('./banner')).ask()) === 'y' ? 'track' : 'stop';
  return g === 'track';
}

/** Starts the tracker once consent allows it. Safe to call again. */
export function start(): void {
  if (phase !== OFF) return;
  phase = STARTING;
  decide()
    .then((ok) => {
      if (phase !== STARTING) return;
      if (ok) begin(loadSession());
      else phase = OFF;
    })
    .catch(() => {
      if (phase === STARTING) phase = OFF;
    });
}

/** "Privacy choices" in the footer: (re)opens the banner. Accept starts the tracker, Reject stops it. */
export function choices(): void {
  import('./banner')
    .then((b) => b.ask(true))
    .then((choice) => (choice === 'y' ? start() : stop()))
    .catch(() => {});
}

/** Client navigation (the loader watches `usePathname`). */
export const nav = guard(pageview);

/** Stops at once and forgets the session: Reject from Privacy choices, or tracking off. Sends nothing. */
export function stop(): void {
  if (phase === ON) save(true);
  phase = OFF;
  queue = [];
  vitals = null;
}

/** Phase 4 click capture asks before recording a click (cap 300 per session). */
export function takeClick(): boolean {
  if (phase !== ON || s.c >= MAX_CLICKS) return false;
  s.c++;
  save();
  return true;
}
