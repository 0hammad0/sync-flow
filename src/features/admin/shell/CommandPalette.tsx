'use client';

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Search } from 'lucide-react';
import Kbd from '@/shared/ui/Kbd';
import Spinner from '@/shared/ui/Spinner';
import type { AccessActorDto } from '@/features/admin/access/types';
import type { searchAdmin } from './actions';
import { ADMIN_SIGN_IN, signInHref } from './account';
import {
  actionEntries,
  filterEntries,
  pageEntries,
  pushRecent,
  readRecent,
  type PaletteActionId,
  type PaletteEntry,
} from './command-registry';
import type { NavGroup } from './nav';
import { useShell } from './ShellFrame';
import { PIN_MIN_WIDTH } from './sidebar-state';
import { endSession, toastError } from './sign-out';
import { SEARCH_MAX, detectQuery, needsServer } from './search-detect';
import type { SearchItemAction, SearchResultDto } from './search-types';
import { toggleTheme } from './ThemeToggle';

// Command palette (16-command-palette.md). Lazy: CommandPaletteTrigger loads
// this chunk on first open. Own listbox (no cmdk: no new dependency, T-22):
// the input is a combobox, results are a listbox of grouped options, focus
// never leaves the input (Tab does nothing), ↑/↓ wrap, ⏎ runs, ⌘⏎ / Ctrl⏎
// opens a link in a new tab, ⌘C / Ctrl+C copies the active row's value.
// Radix Dialog traps focus, closes on Esc / backdrop and locks scroll.

// Follow-up dialogs, each fetched when first used.
const BlockDialog = dynamic(() => import('@/features/admin/access/components/BlockDialog'), { ssr: false });
const ConfirmDialog = dynamic(() => import('@/shared/ui/ConfirmDialog'), { ssr: false });

const DEBOUNCE_MS = 200;
const PREFETCH_DELAY_MS = 100;

type FollowUp = { kind: 'block'; initial?: { type: 'ip' | 'uid'; value: string } } | { kind: 'sign-out-everywhere' };

type Row = {
  key: string;
  title: string;
  subtitle: string | null;
  matches: number[];
  href: string | null;
  actionId: PaletteActionId | null;
  serverAction: SearchItemAction | null;
  copy: string | null;
  /** IP results never go to Recent for roles without ip:read. */
  recent: boolean;
};
type Section = { id: string; label: string; rows: Row[] };

type ServerState =
  | { q: string; kind: 'ok'; result: SearchResultDto }
  | { q: string; kind: 'error' | 'rate' };

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function toastSuccess(title: string, description?: string) {
  const { toast } = await import('sonner');
  toast.success(title, description ? { description } : undefined);
}

/** Title with the matched letters in semibold. */
function Highlight({ text, matches }: { text: string; matches: number[] }) {
  if (matches.length === 0) return <>{text}</>;
  const marked = new Set(matches);
  const parts: ReactNode[] = [];
  let run = '';
  let bold = marked.has(0);
  for (let i = 0; i <= text.length; i++) {
    const isBold = marked.has(i);
    if (i === text.length || isBold !== bold) {
      if (run) parts.push(bold ? <span key={i} className="font-semibold text-fg">{run}</span> : <Fragment key={i}>{run}</Fragment>);
      run = '';
      bold = isBold;
    }
    if (i < text.length) run += text[i];
  }
  return <>{parts}</>;
}

function entryRow(entry: PaletteEntry, matches: number[]): Row {
  return {
    key: entry.id,
    title: entry.title,
    subtitle: entry.subtitle ?? null,
    matches,
    href: entry.href,
    actionId: entry.actionId,
    serverAction: null,
    copy: null,
    recent: Boolean(entry.href),
  };
}

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What had focus when the palette opened; it gets focus back on close. */
  returnFocusRef: RefObject<HTMLElement | null>;
  groups: NavGroup[];
  actions: PaletteActionId[];
  canSeeIp: boolean;
  blockActor: AccessActorDto | null;
  /** The searchAdmin server action, passed in by the trigger (see CommandPaletteTrigger). */
  search: typeof searchAdmin;
};

export default function CommandPalette({ open, onOpenChange, returnFocusRef, groups, actions, canSeeIp, blockActor, search }: CommandPaletteProps) {
  const router = useRouter();
  const { togglePin } = useShell();
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  // Runs once the palette has closed and focus is back on the opener, so a
  // follow-up dialog returns focus there too.
  const afterClose = useRef<(() => void) | null>(null);

  const closeThen = (fn: () => void) => {
    afterClose.current = fn;
    onOpenChange(false);
  };

  const runAction = (id: PaletteActionId) => {
    switch (id) {
      case 'new-block':
        return setFollowUp({ kind: 'block' });
      case 'toggle-theme':
        return toggleTheme();
      case 'toggle-pin':
        return togglePin();
      case 'copy-url':
        return void navigator.clipboard
          ?.writeText(window.location.href)
          .then(() => toastSuccess('URL copied'))
          .catch(() => toastError("Couldn't copy", 'The browser blocked the clipboard.'));
      case 'sign-out':
        return void endSession(false).then((result) => {
          if (result.ok) router.replace(ADMIN_SIGN_IN);
          else void toastError("Couldn't sign out", result.message);
        });
      case 'sign-out-everywhere':
        return setFollowUp({ kind: 'sign-out-everywhere' });
    }
  };

  const run = (row: Row, newTab: boolean) => {
    if (row.href) {
      if (row.recent) pushRecent(safeStorage(), { id: row.key, title: row.title, href: row.href }, canSeeIp);
      if (newTab) {
        window.open(row.href, '_blank', 'noopener');
        return;
      }
      onOpenChange(false);
      router.push(row.href);
      return;
    }
    const action = row.serverAction;
    if (action) closeThen(() => setFollowUp({ kind: 'block', initial: { type: action.type, value: action.value } }));
    else if (row.actionId) closeThen(() => runAction(row.actionId!));
  };

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="ui-fade fixed inset-0 z-50 bg-black/60" />
          <DialogPrimitive.Content
            data-command-palette=""
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              // Controlled dialog with no Radix Trigger: return focus to the opener ourselves.
              event.preventDefault();
              const target = returnFocusRef.current;
              if (target?.isConnected) target.focus();
              const next = afterClose.current;
              afterClose.current = null;
              next?.();
            }}
            className="ui-dialog fixed inset-0 z-50 flex h-dvh flex-col bg-surface text-fg shadow-[var(--shadow-float)] sm:top-[12vh] sm:bottom-auto sm:mx-auto sm:h-auto sm:max-h-[440px] sm:w-[min(560px,92vw)] sm:rounded-xl sm:border sm:border-edge lg:w-[640px]"
          >
            <DialogPrimitive.Title className="sr-only">Search and jump</DialogPrimitive.Title>
            <PaletteBody
              groups={groups}
              actions={actions}
              canSeeIp={canSeeIp}
              hasBlockActor={Boolean(blockActor)}
              search={search}
              onRun={run}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {followUp?.kind === 'block' && blockActor && (
        <BlockDialog
          key={followUp.initial ? `${followUp.initial.type}:${followUp.initial.value}` : 'new'}
          open
          onOpenChange={(next) => !next && setFollowUp(null)}
          actor={blockActor}
          initial={followUp.initial}
          onCreated={(row) => {
            void toastSuccess(`Blocked ${row.value}`);
            router.refresh();
          }}
        />
      )}
      {followUp?.kind === 'sign-out-everywhere' && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setFollowUp(null)}
          title="Sign out everywhere?"
          consequence="Every device signed in to this account is signed out, including this one."
          confirmLabel="Sign out everywhere"
          tone="danger"
          onConfirm={async () => {
            const result = await endSession(true);
            if (!result.ok) {
              void toastError("Couldn't sign out everywhere", result.message);
              return { ok: false, error: 'sign_out_failed', message: result.message };
            }
            router.replace(signInHref(ADMIN_SIGN_IN, '', 'everywhere'));
            return { ok: true };
          }}
        />
      )}
    </>
  );
}

type PaletteBodyProps = {
  groups: NavGroup[];
  actions: PaletteActionId[];
  canSeeIp: boolean;
  hasBlockActor: boolean;
  search: typeof searchAdmin;
  onRun: (row: Row, newTab: boolean) => void;
};

/** Mounted on each open (Radix unmounts closed content), so the query and results start fresh. */
function PaletteBody({ groups, actions, canSeeIp, hasBlockActor, search, onRun }: PaletteBodyProps) {
  const router = useRouter();
  const ids = useId();
  const listboxId = `${ids}-list`;
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [server, setServer] = useState<ServerState | null>(null);
  const [copied, setCopied] = useState(false);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const seq = useRef(0);

  const pages = useMemo(() => pageEntries(groups), [groups]);
  const [recent] = useState(() => readRecent(safeStorage(), pages));
  const [wide] = useState(() => window.innerWidth >= PIN_MIN_WIDTH);
  const actionList = useMemo(
    () =>
      actionEntries(actions).filter(
        // Pinning exists only from 1024 px; New block needs the actor for its self-block check.
        (a) => (a.actionId !== 'toggle-pin' || wide) && (a.actionId !== 'new-block' || hasBlockActor),
      ),
    [actions, wide, hasBlockActor],
  );

  const q = query.trim();
  const shape = useMemo(() => detectQuery(q), [q]);
  const wantsServer = needsServer(shape) && online;

  // Debounced server search. Stale answers (the query changed) are dropped.
  useEffect(() => {
    if (!wantsServer) return;
    const mine = ++seq.current;
    const timer = window.setTimeout(async () => {
      let next: ServerState;
      try {
        const res = await search({ q });
        if (res.ok) next = { q, kind: 'ok', result: res.data };
        else next = { q, kind: res.error === 'rate_limited' ? 'rate' : 'error' };
      } catch {
        next = { q, kind: 'error' };
      }
      if (mine === seq.current) setServer(next);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q, wantsServer, search]);

  const serverNow = wantsServer && server?.q === q ? server : null;
  const loading = wantsServer && !serverNow;

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    if (!q) {
      if (recent.length) out.push({ id: 'recent', label: 'Recent', rows: recent.map((e) => entryRow(e, [])) });
      out.push({ id: 'pages', label: 'Pages', rows: pages.map((e) => entryRow(e, [])) });
      out.push({ id: 'actions', label: 'Actions', rows: actionList.map((e) => entryRow(e, [])) });
      return out;
    }
    const pageHits = filterEntries(pages, q);
    if (pageHits.length) out.push({ id: 'pages', label: 'Pages', rows: pageHits.map((h) => entryRow(h.entry, h.matches)) });
    if (serverNow?.kind === 'ok') {
      for (const group of serverNow.result.groups) {
        out.push({
          id: group.id,
          label: group.label,
          rows: group.items.map((item) => ({
            key: `${group.id}:${item.id}`,
            title: item.title,
            subtitle: item.subtitle,
            matches: [],
            href: item.href,
            actionId: null,
            serverAction: item.action?.id === 'block' && hasBlockActor ? item.action : null,
            copy: item.copy,
            recent: group.id !== 'ip' || canSeeIp,
          })),
        });
      }
    }
    const actionHits = filterEntries(actionList, q);
    if (actionHits.length) out.push({ id: 'actions', label: 'Actions', rows: actionHits.map((h) => entryRow(h.entry, h.matches)) });
    return out;
  }, [q, recent, pages, actionList, serverNow, hasBlockActor, canSeeIp]);

  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const runnable = (row: Row) => Boolean(row.href || row.actionId || row.serverAction);
  const active = rows.length ? Math.min(activeIndex, rows.length - 1) : -1;
  const activeRow = active >= 0 ? rows[active] : null;
  const optionId = (i: number) => `${ids}-opt-${i}`;

  // Keep the active row in view, and prefetch its page after 100 ms on it.
  const activeHref = activeRow?.href ?? null;
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${ids}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, ids]);
  useEffect(() => {
    if (!activeHref || activeHref.includes('?')) return;
    const timer = window.setTimeout(() => router.prefetch(activeHref), PREFETCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeHref, router]);

  const move = (delta: number) => {
    if (!rows.length) return;
    setActiveIndex((active + delta + rows.length) % rows.length);
  };

  const copyActive = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      void toastError("Couldn't copy", 'The browser blocked the clipboard.');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeRow && runnable(activeRow)) onRun(activeRow, mod && Boolean(activeRow.href));
    } else if (event.key === 'Tab') {
      // Focus stays in the input; ↑/↓ move through the results.
      event.preventDefault();
    } else if (mod && event.key.toLowerCase() === 'c' && activeRow?.copy) {
      const input = event.currentTarget;
      if (input.selectionStart !== input.selectionEnd) return; // copying typed text
      event.preventDefault();
      void copyActive(activeRow.copy);
    }
  };

  // Notes under the input: never options, so the listbox holds options only.
  const notes: string[] = [];
  if (q && !online && needsServer(shape)) notes.push('Offline — searching pages and actions only.');
  if (shape.kind === 'partial-ip') notes.push(shape.family === 4 ? 'Type the full IP address.' : 'Type the full IPv6 address.');
  if (serverNow?.kind === 'error') notes.push('Search failed. Pages and actions still work.');
  if (serverNow?.kind === 'rate') notes.push('Too many searches. Wait a moment.');
  if (serverNow?.kind === 'ok' && serverNow.result.notice === 'budget') notes.push("Today's read budget is used up, so some results were skipped.");
  if (serverNow?.kind === 'ok' && serverNow.result.notice === 'error') notes.push('Part of the search failed. Other results still work.');

  const resultCount = rows.length;
  const empty = q && !loading && resultCount === 0;

  let index = -1;
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4">
        <Search aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-fg-muted" />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          aria-label="Search pages, IPs, users, rooms and files"
          placeholder="Search or jump…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={SEARCH_MAX}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-muted sm:text-sm"
        />
        {loading && <Spinner size={12} label="Searching" className="shrink-0 text-fg-muted" />}
        <span className="hidden shrink-0 lg:inline-flex">
          <Kbd keys={['Esc']} />
        </span>
        <DialogPrimitive.Close className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-sm text-brand-text sm:hidden">
          Cancel
        </DialogPrimitive.Close>
      </div>

      {notes.length > 0 && (
        <div className="shrink-0 border-b border-edge px-4 py-2 text-xs text-fg-muted">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}

      {empty ? (
        <div className="shrink-0 px-4 py-8 text-center text-sm">
          <p className="text-fg">No results for &ldquo;{q}&rdquo;.</p>
          <p className="mt-1 text-fg-muted">Try an IP, email, user id, room code or session id.</p>
        </div>
      ) : null}
      {/* The listbox itself scrolls: it is the combobox's popup, so ↑/↓ on the input
          reach every row (axe scrollable-region-focusable, WCAG 2.1.1). A wrapper
          that scrolled instead would be a region no key can reach. */}
      <div
        id={listboxId}
        role="listbox"
        aria-label="Results"
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${empty ? '' : 'p-2'}`}
      >
        {sections.map((section) => {
          const headingId = `${ids}-g-${section.id}`;
          return (
            <div key={section.id} role="group" aria-labelledby={headingId} className="mb-1 last:mb-0">
              <div id={headingId} className="px-2 pt-2 pb-1 font-mono text-[11px] tracking-wider text-fg-muted uppercase">
                {section.label}
              </div>
              {section.rows.map((row) => {
                index += 1;
                const i = index;
                const selected = i === active;
                return (
                  <div
                    key={row.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={runnable(row) ? undefined : true}
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerMove={() => i !== active && setActiveIndex(i)}
                    onClick={(event) => runnable(row) && onRun(row, (event.metaKey || event.ctrlKey) && Boolean(row.href))}
                    className={`relative flex min-h-12 items-center gap-3 rounded-md px-3 text-sm sm:min-h-10 lg:min-h-9 ${
                      runnable(row) ? 'cursor-pointer' : 'cursor-default text-fg-muted'
                    } ${selected ? 'bg-surface-2 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <Highlight text={row.title} matches={row.matches} />
                    </span>
                    {row.subtitle && <span className="hidden max-w-[45%] shrink-0 truncate text-xs text-fg-muted sm:inline">{row.subtitle}</span>}
                    {selected && runnable(row) && (
                      <span aria-hidden="true" className="hidden shrink-0 lg:inline-flex">
                        <Kbd keys={['⏎']} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="hidden shrink-0 items-center gap-4 border-t border-edge px-4 py-2 text-xs text-fg-muted lg:flex">
        <span className="inline-flex items-center gap-1">
          <Kbd keys={['↑']} />
          <Kbd keys={['↓']} /> move
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd keys={['⏎']} /> open
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd keys={['mod', '⏎']} /> new tab
        </span>
        {activeRow?.copy && (
          <span className="inline-flex items-center gap-1">
            <Kbd keys={['mod', 'C']} /> copy
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          <Kbd keys={['Esc']} /> close
        </span>
      </div>

      <div aria-live="polite" className="sr-only">
        {loading ? '' : `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`}
      </div>
      <div role="status" className="sr-only">
        {copied ? 'Copied' : ''}
      </div>
    </>
  );
}
