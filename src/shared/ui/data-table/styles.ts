// Class strings shared by the data-table parts. Buttons live in
// ../button-styles.ts (one source for every admin button).

/** Columns by priority: P2 from a 640 px table container, P3 from 960 px. */
export const PRIORITY_CELL = {
  1: '',
  2: 'hidden @[640px]:table-cell',
  3: 'hidden @[960px]:table-cell',
} as const;

/** `en-US` grouping: 1,204. */
export const formatCount = (n: number) => n.toLocaleString('en-US');
