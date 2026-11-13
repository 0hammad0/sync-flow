import { render } from '@testing-library/react';
import { withNuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { vi } from 'vitest';
import DataTable, { type DataTableProps } from '@/shared/ui/data-table/DataTable';
import { createAdminColumnHelper } from '@/shared/ui/data-table/types';

// The table reads the path and current params to build real page links,
// and prefetches a row's detail page on hover.
export const prefetch = vi.fn();
let currentSearch = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch }),
  usePathname: () => '/admin/sessions',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

export type Session = {
  id: string;
  ip: string;
  country: string;
  started: string;
  pages: number;
  referrer: string | null;
};

const col = createAdminColumnHelper<Session>();
export const columns = col.columns([
  col.accessor('ip', { header: 'IP', meta: { priority: 1, kind: 'ip', card: 'title' } }),
  col.accessor('started', {
    id: 'started_at',
    header: 'Started',
    meta: { priority: 1, sortable: true, defaultDesc: true, kind: 'time', card: 'trailing' },
  }),
  // Sortable in meta but not in the server allowlist: no sort button.
  col.accessor('country', { header: 'Country', meta: { priority: 2, sortable: true, card: 'subtitle' } }),
  col.accessor('pages', {
    header: 'Pages',
    meta: { priority: 2, sortable: true, defaultDesc: true, align: 'right', kind: 'number' },
  }),
  col.accessor('referrer', { header: 'Referrer', meta: { priority: 3 } }),
]);

export const sessions: Session[] = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i + 1}`,
  ip: `203.0.113.${i + 1}`,
  country: i % 2 ? 'US' : 'PK',
  started: `${i + 1}m ago`,
  pages: i + 1,
  referrer: i === 0 ? null : 'google.com',
}));

export const SORT = { allowed: ['started_at', 'pages'], default: '-started_at' } as const;

/** jsdom has no ResizeObserver: report a fixed container width. */
export function mockContainerWidth(width: number) {
  class FixedResizeObserver {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(target: Element) {
      this.cb([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
}

type Options = {
  search?: string;
  width?: number;
  props?: Partial<DataTableProps<Session>>;
};

/** Renders a sessions table inside nuqs' testing adapter. `onUrlUpdate` records every URL write. */
export function renderTable({ search = '', width = 1024, props = {} }: Options = {}) {
  currentSearch = search;
  mockContainerWidth(width);
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
  const utils = render(
    <DataTable<Session>
      label="Sessions"
      columns={columns}
      rows={sessions}
      getRowId={(row) => row.id}
      rowLabel={(row) => row.ip}
      rowHref={(row) => `/admin/sessions/${row.id}`}
      sort={{ allowed: [...SORT.allowed], default: SORT.default }}
      page={{ prevCursor: null, nextCursor: 'c2', total: 1204 }}
      empty={{ title: 'No sessions yet', body: 'Sessions appear after the first visit.' }}
      search={{ placeholder: 'Search IP, path or id' }}
      {...props}
    />,
    { wrapper: withNuqsTestingAdapter({ searchParams: search, onUrlUpdate, hasMemory: true }) },
  );
  /** The query string of the last URL write. */
  const lastUrl = () => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams;
  return { ...utils, onUrlUpdate, lastUrl };
}
