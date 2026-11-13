// "10 min with no input" for the polls (T-26). One watcher per page, shared by
// the top-bar count, the Overview badge and Live, so all three pause and
// resume together. Activity only stamps a time; a single timer checks it, so
// pointermove costs nothing. Once idle it stays idle until resume() ("Paused,
// click to resume"), even if the mouse moves again.

export const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export type IdleStoreOptions = {
  timeoutMs: number;
  target: Target;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

/** A `useSyncExternalStore` store: `getSnapshot()` is true once idle. */
export type IdleStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => boolean;
  /** Back to active (and starts watching again if anyone listens). */
  resume: () => void;
};

const LISTEN = { capture: true, passive: true } as const;

export function createIdleStore({
  timeoutMs,
  target,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
}: IdleStoreOptions): IdleStore {
  let idle = false;
  let last = 0;
  let timer: unknown = null;
  let watching = false;
  const listeners = new Set<() => void>();

  const onActivity = () => {
    last = now();
  };
  const emit = () => {
    for (const l of listeners) l();
  };

  const check = () => {
    timer = null;
    const quiet = now() - last;
    if (quiet >= timeoutMs) {
      idle = true;
      stop();
      emit();
    } else {
      timer = setTimer(check, timeoutMs - quiet);
    }
  };

  function start() {
    if (watching) return;
    watching = true;
    last = now();
    for (const type of ACTIVITY_EVENTS) target.addEventListener(type, onActivity, LISTEN);
    timer = setTimer(check, timeoutMs);
  }

  function stop() {
    if (!watching) return;
    watching = false;
    for (const type of ACTIVITY_EVENTS) target.removeEventListener(type, onActivity, LISTEN);
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!idle) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => idle,
    resume() {
      if (!idle) {
        last = now();
        return;
      }
      idle = false;
      if (listeners.size > 0) start();
      emit();
    },
  };
}
