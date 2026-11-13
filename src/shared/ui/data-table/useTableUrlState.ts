'use client';

import { useMemo, useState, useTransition } from 'react';
import { debounce, useQueryStates } from 'nuqs';
import { DENSITY_COOKIE, type Density } from './types';
import { createTableParsers, FIRST_PAGE_CURSOR, type SortConfig } from './url-state';

/** Search box debounce (08-tables.md "Toolbar"). */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * The table's view state in the URL. Needs nuqs' Next app-router adapter
 * (`NuqsAdapter` from `nuqs/adapters/next/app`) above it.
 *
 * - `shallow: false`: the Server Component re-reads the params and re-queries.
 * - Updates run in a transition, so `refreshing` is true while the server
 *   answers and the old rows stay on screen (no skeleton).
 * - Sort, search and page are pushed (Back works). Search uses replace so
 *   each keystroke is not a history entry.
 * - Changing sort or search drops `cursor` (back to the first page).
 */
export function useTableUrlState(sort: SortConfig, defaultDensity: Density) {
  const allowedKey = sort.allowed.join(',');
  // Rebuild only when the allowlist or default actually change.
  const parsers = useMemo(
    () => createTableParsers({ allowed: allowedKey ? allowedKey.split(',') : [], default: sort.default }),
    [allowedKey, sort.default],
  );
  const [refreshing, startTransition] = useTransition();
  const [state, setState] = useQueryStates(parsers, { shallow: false, startTransition, history: 'push' });
  // Density is a per-browser preference: a cookie, overridden by ?density= on a shared link.
  const [savedDensity, setSavedDensity] = useState<Density>(defaultDensity);

  return {
    sort: state.sort,
    q: state.q,
    hiddenColumns: state.cols,
    density: state.density ?? savedDensity,
    cursor: state.cursor,
    refreshing,
    setSort: (value: string) => setState({ sort: value, cursor: null }),
    setQuery: (value: string) =>
      setState(
        { q: value || null, cursor: null },
        // Clearing applies at once; typing waits for a pause.
        { history: 'replace', limitUrlUpdates: value ? debounce(SEARCH_DEBOUNCE_MS) : undefined },
      ),
    setCursor: (value: string | null) =>
      setState({ cursor: value === FIRST_PAGE_CURSOR ? null : value }),
    // Visual only: the server does not need to re-render.
    setHiddenColumns: (ids: string[]) => setState({ cols: ids.length ? ids : null }, { shallow: true }),
    setDensity: (value: Density) => {
      document.cookie = `${DENSITY_COOKIE}=${value}; path=/admin; max-age=31536000; samesite=lax`;
      setSavedDensity(value);
      if (state.density !== null) setState({ density: null }, { shallow: true });
    },
    clearSearch: () => setState({ q: null, cursor: null }, { history: 'replace' }),
  };
}

export type TableUrlState = ReturnType<typeof useTableUrlState>;
