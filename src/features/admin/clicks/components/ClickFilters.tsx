'use client';

import { useTransition } from 'react';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import SegmentedControl from '@/shared/ui/SegmentedControl';
import Select from '@/shared/ui/Select';
import { CLICK_VIEW_LABELS, CLICK_VIEWS, VW_BUCKETS, VW_LABELS, type ClickView } from '../constants';
import type { VwBucket } from '../types';

type ClickFiltersProps = {
  /** Tracked paths (busiest first) and whether each can be shown as a map. */
  paths: readonly { path: string; mapAllowed: boolean }[];
  path: string;
  vw: VwBucket;
  view: ClickView;
};

/**
 * Page, viewport and view (06-clicks.md "Layout"), kept in the URL
 * (`?path&vw&view`). Every change re-renders on the server; the range stays.
 */
export default function ClickFilters({ paths, path, vw, view }: ClickFiltersProps) {
  const [pending, startTransition] = useTransition();
  const [, setParams] = useQueryStates(
    {
      path: parseAsString,
      vw: parseAsStringLiteral(VW_BUCKETS),
      view: parseAsStringLiteral(CLICK_VIEWS),
    },
    { shallow: false, history: 'push', startTransition },
  );

  const options = paths.some((p) => p.path === path) ? paths : [{ path, mapAllowed: false }, ...paths];

  return (
    <div
      className={`mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 ${pending ? 'opacity-60 transition-opacity' : ''}`}
      aria-busy={pending || undefined}
    >
      <Select
        label="Page"
        size="sm"
        className="w-full min-[480px]:w-64"
        value={path}
        onValueChange={(next) => void setParams({ path: next })}
        options={options.map((p) => ({ value: p.path, label: p.mapAllowed ? p.path : `${p.path} · list only` }))}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">
          Viewport
        </span>
        <SegmentedControl
          label="Viewport"
          size="sm"
          value={vw}
          onValueChange={(next) => void setParams({ vw: next === 'lg' ? null : next })}
          items={VW_BUCKETS.map((b) => ({ value: b, label: VW_LABELS[b].label }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">View</span>
        <SegmentedControl
          label="View"
          size="sm"
          value={view}
          onValueChange={(next) => void setParams({ view: next === 'list' ? null : next })}
          items={CLICK_VIEWS.map((v) => ({ value: v, label: CLICK_VIEW_LABELS[v] }))}
        />
      </div>
    </div>
  );
}
