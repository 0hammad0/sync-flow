'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Scene from '@/features/landing/Scene';

export interface ToolTab {
  id: string;
  label: string;
  icon: React.ReactNode;
  scene: React.ReactNode;
  /** Short HTML captions shown under the illustration, left → right. */
  captions: string[];
  steps: { title: string; text: string }[];
  cta: { label: string; href: string };
  note: { icon: React.ReactNode; text: string };
}

/**
 * "How it works" — one tab per tool (WAI-ARIA tabs, automatic activation).
 * All panels are server-rendered; without JS the tab bar is hidden and every
 * panel shows (see globals.css), so nothing is lost.
 */
export default function ToolTabs({ tools }: { tools: ToolTab[] }) {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (i: number) => {
    const next = (i + tools.length) % tools.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') select(active + 1);
    else if (e.key === 'ArrowLeft') select(active - 1);
    else if (e.key === 'Home') select(0);
    else if (e.key === 'End') select(tools.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Choose a tool"
        data-tablist
        onKeyDown={onKeyDown}
        className="grid grid-cols-3 gap-1 rounded-xl border border-edge bg-surface-2/70 p-1 sm:inline-grid sm:w-auto"
      >
        {tools.map((t, i) => {
          const selected = i === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-2 sm:px-4 text-[13px] sm:text-sm font-medium transition-[background-color,color,box-shadow] duration-200 cursor-pointer ${
                selected
                  ? 'bg-surface text-fg shadow-[var(--shadow-card)]'
                  : 'text-fg-muted hover:text-fg'
              }`}
            >
              <span className={`max-sm:hidden ${selected ? 'text-brand-text' : ''}`}>{t.icon}</span>
              <span className="whitespace-nowrap">{t.label}</span>
            </button>
          );
        })}
      </div>

      {tools.map((t, i) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`panel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          data-tabpanel
          hidden={i !== active}
          className="mt-6 sm:mt-8"
        >
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
            <figure className="stage rounded-2xl border border-edge p-4 sm:p-6">
              <Scene>{t.scene}</Scene>
              <figcaption
                className="relative mt-3 grid gap-2 text-center text-xs text-fg-muted"
                style={{ gridTemplateColumns: `repeat(${t.captions.length}, minmax(0, 1fr))` }}
              >
                {t.captions.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </figcaption>
            </figure>

            <div>
              <h3 className="font-display text-2xl sm:text-[1.75rem] font-bold tracking-tight text-fg text-balance">
                {t.label}
              </h3>
              <ol className="mt-6 space-y-5">
                {t.steps.map((s, n) => (
                  <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-3">
                    <span
                      className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-edge-strong font-mono text-xs text-fg-muted tabular-nums"
                      aria-hidden="true"
                    >
                      {n + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-fg">{s.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-fg-muted max-w-prose">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Link
                  href={t.cta.href}
                  className="group inline-flex h-11 items-center gap-2 rounded-xl bg-flow px-5 text-sm font-semibold text-white shadow-md transition-[filter,box-shadow] duration-200 hover:brightness-110 hover:shadow-[var(--glow)]"
                >
                  {t.cta.label}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
                <p className="inline-flex items-center gap-2 text-sm text-fg-muted">
                  {t.note.icon}
                  {t.note.text}
                </p>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
