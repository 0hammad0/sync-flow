'use client';

import { useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { parseAsString, useQueryStates } from 'nuqs';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { buttonClass } from '@/shared/ui/button-styles';
import Popover from '@/shared/ui/Popover';
import Skeleton from '@/shared/ui/Skeleton';
import {
  RANGE_LABELS,
  RANGE_PRESETS,
  RANGE_SHORT_LABELS,
  DEFAULT_RANGE,
  formatDaySpan,
  type RangeKind,
  type RangePreset,
} from '@/features/admin/analytics/range';
import { rangeParsers } from '@/features/admin/analytics/range-parsers';
import { usesDateRange } from './nav';

// The calendar part (two date fields + checks) loads only when "Custom range" opens.
const DateRangeCalendar = dynamic(() => import('./DateRangeCalendar'), {
  ssr: false,
  loading: () => (
    <div aria-busy="true" className="flex flex-col gap-2 pt-1">
      <span className="sr-only">Loading custom range</span>
      <Skeleton className="h-8 w-full" shape="block" />
      <Skeleton className="h-8 w-full" shape="block" />
    </div>
  ),
});

const PARSERS = { ...rangeParsers, cursor: parseAsString };

/** Trigger text: preset name, or the custom days. Needs no clock, so SSR and hydration agree. */
function labelFor(range: RangeKind | null, from: string | null, to: string | null): { long: string; short: string } {
  if (range === 'custom' || (range === null && from && to)) {
    if (from && to) {
      const text = from <= to ? formatDaySpan(from, to) : formatDaySpan(to, from);
      return { long: text, short: RANGE_SHORT_LABELS.custom };
    }
  }
  const preset: RangePreset = range && range !== 'custom' ? range : DEFAULT_RANGE;
  return { long: RANGE_LABELS[preset], short: RANGE_SHORT_LABELS[preset] };
}

/**
 * Top-bar date range for the analytics screens: presets (today, 24h, 7d,
 * 30d, 90d) and a custom range. State lives in the URL (`?range=7d` or
 * `?range=custom&from=…&to=…`) via nuqs; a change re-renders the server page
 * in a transition and drops the sessions cursor. Hidden on Live and on every
 * non-analytics page. Days are UTC.
 */
export default function DateRangePicker() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(PARSERS, { shallow: false, history: 'push', startTransition });

  if (!usesDateRange(pathname)) return null;

  const isCustom = params.range === 'custom' || (params.range === null && Boolean(params.from && params.to));
  const selected: RangePreset | 'custom' = isCustom ? 'custom' : (params.range ?? DEFAULT_RANGE);
  const label = labelFor(params.range, params.from, params.to);

  const choosePreset = (preset: RangePreset) => {
    setOpen(false);
    // The default (7d) is written too, so a shared link keeps its range.
    void setParams({ range: preset, from: null, to: null, cursor: null });
  };

  const applyCustom = (from: string, to: string) => {
    setOpen(false);
    void setParams({ range: 'custom', from, to, cursor: null });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setCustomOpen(selected === 'custom');
      }}
      align="end"
      aria-label="Date range"
      className="w-[min(18rem,calc(100vw-2rem))]"
      trigger={
        <button
          type="button"
          aria-busy={pending || undefined}
          aria-label={`Date range: ${label.long}`}
          className={buttonClass({ variant: 'secondary', size: 'sm', className: 'max-w-[11rem] sm:max-w-none' })}
        >
          <CalendarDays aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          <span className="truncate sm:hidden">{label.short}</span>
          <span className="hidden truncate sm:inline">{label.long}</span>
          <ChevronDown aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
        </button>
      }
    >
      <div className="flex flex-col gap-0.5" role="group" aria-label="Date range presets">
        {RANGE_PRESETS.map((preset) => {
          const active = selected === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={active}
              onClick={() => choosePreset(preset)}
              className={buttonClass({ variant: 'ghost', size: 'sm', fullWidth: true, className: 'justify-between' })}
            >
              {RANGE_LABELS[preset]}
              {active && <Check aria-hidden="true" strokeWidth={2} className="size-3.5" />}
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={customOpen}
          aria-pressed={selected === 'custom'}
          onClick={() => setCustomOpen((v) => !v)}
          className={buttonClass({ variant: 'ghost', size: 'sm', fullWidth: true, className: 'justify-between' })}
        >
          {RANGE_LABELS.custom}…
          {selected === 'custom' && <Check aria-hidden="true" strokeWidth={2} className="size-3.5" />}
        </button>
      </div>
      {customOpen && (
        <div className="mt-2 border-t border-edge pt-2">
          <DateRangeCalendar
            initialFrom={isCustom ? params.from : null}
            initialTo={isCustom ? params.to : null}
            onApply={applyCustom}
          />
        </div>
      )}
      <p className="mt-2 text-xs text-fg-muted">Days are in UTC.</p>
    </Popover>
  );
}
