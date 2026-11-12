'use client';

// WhatsApp-style reactions: the pill that sits on a bubble's bottom edge,
// the "who reacted" details panel, and the "+" emoji grid. Identity is the
// per-device reactor id only — display names can collide, so "is this me"
// never compares names.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { EMOJI_SET, normalizeReactors } from '@/shared/lib/utils';
import { clampToContainer } from '@/features/chat/lib/clamp-to-container';
import type { ChatMessage, ChatReactor } from '@/types';

export interface ReactionGroup {
  emoji: string;
  reactors: ChatReactor[];
}

// Non-empty groups, most-used first. Array#sort is stable, so equal counts
// keep their stored order.
export function groupReactions(raw: ChatMessage['reactions']): ReactionGroup[] {
  return Object.entries(raw ?? {})
    .map(([emoji, list]) => ({ emoji, reactors: normalizeReactors(list) }))
    .filter((g) => g.reactors.length > 0)
    .sort((a, b) => b.reactors.length - a.reactors.length);
}

// "😂 2, 👍 1" — used in aria labels.
export function reactionSummary(groups: ReactionGroup[]): string {
  return groups.map((g) => `${g.emoji} ${g.reactors.length}`).join(', ');
}

// Your own row first, then everyone else in stored order.
function meFirst<T>(items: T[], isMe: (item: T) => boolean): T[] {
  return [...items.filter(isMe), ...items.filter((i) => !isMe(i))];
}

const TOOLTIP_NAMES_PER_EMOJI = 5;

// "😂 You, Ali · 👍 Sara"
function tooltipText(groups: ReactionGroup[], myId: string): string {
  return groups
    .map((g) => {
      const names = meFirst(g.reactors, (r) => r.id === myId).map((r) =>
        r.id === myId ? 'You' : r.name
      );
      const shown = names.slice(0, TOOLTIP_NAMES_PER_EMOJI).join(', ');
      const more = names.length - TOOLTIP_NAMES_PER_EMOJI;
      return `${g.emoji} ${shown}${more > 0 ? ` +${more}` : ''}`;
    })
    .join(' · ');
}

// The pill on the bubble's bottom edge: top 3 emoji + total count. Hover
// (fine pointers) or keyboard focus shows who reacted; click/tap/Enter opens
// the details panel.
export function ReactionPill({
  groups,
  myId,
  mine,
  expanded,
  onOpen,
  pillRef,
}: {
  groups: ReactionGroup[];
  myId: string;
  mine: boolean;
  expanded: boolean;
  onOpen: () => void;
  pillRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const tipId = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const total = groups.reduce((n, g) => n + g.reactors.length, 0);
  // The tooltip is shown by CSS (:hover / :focus-visible); clamp it inside
  // the message list once it's displayed (next frame).
  const clampTip = () => requestAnimationFrame(() => clampToContainer(tipRef.current, { flipOffset: '0.375rem' }));
  return (
    <div className={`absolute -bottom-3.5 z-[1] ${mine ? 'right-2' : 'left-2'}`}>
      <button
        ref={pillRef}
        type="button"
        onClick={onOpen}
        onPointerEnter={clampTip}
        onFocus={clampTip}
        aria-label={`Reactions: ${reactionSummary(groups)}. Show who reacted`}
        aria-describedby={tipId}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        className="peer flex items-center h-6 pl-1 pr-1.5 gap-0.5 rounded-full bg-surface border border-edge shadow-sm text-xs cursor-pointer hover:bg-surface-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      >
        <span className="flex items-center text-sm leading-none" aria-hidden="true">
          {groups.slice(0, 3).map((g) => (
            <span key={g.emoji}>{g.emoji}</span>
          ))}
        </span>
        {total > 1 && (
          <span className="pl-0.5 text-fg-muted tabular-nums" aria-hidden="true">
            {total}
          </span>
        )}
      </button>
      <div
        ref={tipRef}
        id={tipId}
        role="tooltip"
        className={`hidden pointer-fine:peer-hover:block peer-focus-visible:block absolute bottom-full mb-1.5 w-max max-w-64 [overflow-wrap:anywhere] px-2.5 py-1.5 rounded-lg bg-fg text-canvas text-xs leading-snug shadow-lg pointer-events-none ${
          mine ? 'right-0' : 'left-0'
        }`}
      >
        {tooltipText(groups, myId)}
      </div>
    </div>
  );
}

// Emoji grid columns: up to 8 (the old fixed layout), fewer when the grid
// is too narrow for 8 cells of `minCell`, so cells never squeeze or overflow.
// The 0.125rem matches the grid's `gap-0.5`.
export function emojiGridColumns(minCell: string): React.CSSProperties {
  return {
    gridTemplateColumns: `repeat(auto-fill, minmax(max(${minCell}, calc((100% - 7 * 0.125rem) / 8)), 1fr))`,
  };
}

// Full emoji grid behind the quick bar's "+" button.
export function ReactionEmojiGrid({
  selected,
  onPick,
  large = false,
}: {
  selected: string | null;
  onPick: (emoji: string) => void;
  large?: boolean;
}) {
  return (
    <div
      className={`grid gap-0.5 min-h-0 overflow-y-auto overflow-x-hidden ${
        large ? 'max-h-56' : 'max-h-44 w-72 max-w-full'
      }`}
      style={emojiGridColumns(large ? '2.75rem' : '2rem')}
      role="group"
      aria-label="All reactions"
    >
      {EMOJI_SET.map((emoji) => {
        const active = emoji === selected;
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            className={`flex items-center justify-center ${large ? 'text-2xl p-1.5' : 'text-xl p-1'} rounded-lg cursor-pointer transition-colors hover:bg-surface-2 active:bg-surface-2 ${
              active ? 'bg-brand/15 ring-1 ring-brand' : ''
            }`}
            aria-label={active ? `Remove ${emoji} reaction` : `React with ${emoji}`}
            aria-pressed={active}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}

const SWIPE_CLOSE_PX = 80;
const SWIPE_START_PX = 6;

// "Who reacted" panel: bottom sheet on phones, centered modal from sm up.
// Tabs: All + one per emoji. Your own row reads "You · Tap to remove".
// Closes on backdrop click, Esc, the close button, or a swipe down on the
// sheet's header.
export function ReactionDetails({
  groups,
  myId,
  onRemove,
  onClose,
  returnFocusRef,
}: {
  groups: ReactionGroup[];
  myId: string;
  onRemove: (emoji: string) => void;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const [tab, setTab] = useState<string>('all');
  // A live update can empty the open emoji tab — fall back to All.
  const activeTab = tab !== 'all' && !groups.some((g) => g.emoji === tab) ? 'all' : tab;
  const total = groups.reduce((n, g) => n + g.reactors.length, 0);
  const baseId = useId();
  const tabId = (key: string) => `${baseId}-tab-${key === 'all' ? 'all' : [...key].map((c) => c.codePointAt(0)).join('-')}`;
  const panelId = `${baseId}-panel`;
  const titleId = `${baseId}-title`;

  const rows = useMemo(() => {
    const flat = groups.flatMap((g) => g.reactors.map((reactor) => ({ reactor, emoji: g.emoji })));
    const filtered = activeTab === 'all' ? flat : flat.filter((r) => r.emoji === activeTab);
    return meFirst(filtered, (r) => r.reactor.id === myId);
  }, [groups, activeTab, myId]);

  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus into the dialog on open, trap Tab inside it, Esc closes, and
  // focus returns to the pill (or wherever it was) on close.
  useEffect(() => {
    const sheet = sheetRef.current;
    const returnTo = returnFocusRef.current;
    sheet?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !sheet) return;
      const focusables = Array.from(
        sheet.querySelectorAll<HTMLElement>('button:not([disabled])')
      ).filter((el) => el.tabIndex >= 0);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === sheet)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);

  // Swipe down on the header to dismiss. Uses the standalone `translate`
  // property so it composes with the entrance animation's `transform`.
  const drag = useRef<{ startY: number; dy: number; active: boolean } | null>(null);
  const onDragStart = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    drag.current = { startY: e.clientY, dy: 0, active: false };
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const sheet = sheetRef.current;
    if (!d || !sheet) return;
    d.dy = Math.max(0, e.clientY - d.startY);
    if (!d.active && d.dy > SWIPE_START_PX) {
      // Capture only once it's clearly a drag, so taps on tabs still click.
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      sheet.style.transition = 'none';
    }
    if (d.active) sheet.style.translate = `0 ${d.dy}px`;
  };
  const onDragEnd = () => {
    const d = drag.current;
    const sheet = sheetRef.current;
    drag.current = null;
    if (!d?.active || !sheet) return;
    if (d.dy > SWIPE_CLOSE_PX) {
      onClose();
      return;
    }
    sheet.style.transition = 'translate 0.2s ease-out';
    sheet.style.translate = '';
  };

  const tabs = ['all', ...groups.map((g) => g.emoji)];
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.indexOf(activeTab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  return createPortal(
    // Phones: bottom sheet with an 8px gap to the screen edges. sm+: modal
    // centered below the site header, 16px from every edge.
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4 sm:pt-[calc(var(--site-header-h,3.75rem)+1rem)]">
      <div
        className="absolute inset-0 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-md sm:max-w-sm max-h-[min(70dvh,100%)] sm:max-h-[min(28rem,100%)] flex flex-col bg-surface border border-edge shadow-lg rounded-2xl outline-none animate-menu-up"
      >
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="touch-none sm:touch-auto"
        >
          <div className="sm:hidden mx-auto mt-2 w-9 h-1 rounded-full bg-edge-strong" aria-hidden="true" />
          <div className="flex items-center justify-between pl-4 pr-2 pt-2 sm:pt-3">
            <h2 id={titleId} className="text-sm font-semibold text-fg">
              {total} {total === 1 ? 'reaction' : 'reactions'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer"
              aria-label="Close reactions"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div
            role="tablist"
            aria-label="Filter reactions by emoji"
            onKeyDown={onTabKey}
            className="flex gap-1 px-2 mt-1 border-b border-edge overflow-x-auto no-scrollbar touch-pan-x"
          >
            {tabs.map((key) => {
              const selected = key === activeTab;
              const count =
                key === 'all' ? total : (groups.find((g) => g.emoji === key)?.reactors.length ?? 0);
              return (
                <button
                  key={key}
                  id={tabId(key)}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(key)}
                  className={`shrink-0 flex items-center gap-1 px-3 py-2 -mb-px border-b-2 text-sm cursor-pointer transition-colors ${
                    selected
                      ? 'border-brand text-fg font-medium'
                      : 'border-transparent text-fg-muted hover:text-fg'
                  }`}
                >
                  {key === 'all' ? 'All' : <span className="text-base leading-none">{key}</span>}
                  <span className="tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
        <ul
          id={panelId}
          role="tabpanel"
          aria-labelledby={tabId(activeTab)}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-1"
        >
          {rows.map(({ reactor, emoji }) => {
            const isMe = reactor.id === myId;
            const body = (
              <>
                <span
                  className="w-8 h-8 shrink-0 rounded-full bg-surface-3 text-fg-muted text-sm font-medium flex items-center justify-center"
                  aria-hidden="true"
                >
                  {(isMe ? 'Y' : reactor.name.trim().charAt(0) || '?').toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-fg truncate">{isMe ? 'You' : reactor.name}</span>
                  {isMe && <span className="block text-xs text-fg-muted">Tap to remove</span>}
                </span>
                <span className="text-xl leading-none">{emoji}</span>
              </>
            );
            return (
              <li key={`${emoji}:${reactor.id}`}>
                {isMe ? (
                  <button
                    type="button"
                    onClick={() => onRemove(emoji)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer hover:bg-surface-2 active:bg-surface-2 transition-colors"
                    aria-label={`Your reaction ${emoji}. Remove it`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body
  );
}
