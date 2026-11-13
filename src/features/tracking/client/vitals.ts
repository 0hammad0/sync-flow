import { onCLS, onINP, onLCP } from 'web-vitals';

/**
 * Web Vitals for the 1 in 10 sampled sessions (phase 2.8). Its own lazy chunk
 * together with `web-vitals` (plain build: the attribution build adds ~2.2 KB
 * gz and we only send the values), so the tracker chunk stays under 2 KB.
 *
 * `reportAllChanges` keeps the latest LCP, INP and CLS in memory as they
 * change; the tracker sends them with its next flush (no extra write), so the
 * values are current even when the tab is killed after `hidden`.
 */

export type Vitals = { lcp?: number; inp?: number; cls?: number };

export function watchVitals(onChange: (vitals: Vitals) => void): void {
  const vitals: Vitals = {};
  const set = (key: keyof Vitals, digits: number) => (metric: { value: number }) => {
    vitals[key] = Number(metric.value.toFixed(digits));
    onChange(vitals);
  };
  const opts = { reportAllChanges: true };
  onLCP(set('lcp', 0), opts);
  onINP(set('inp', 0), opts);
  onCLS(set('cls', 4), opts);
}
