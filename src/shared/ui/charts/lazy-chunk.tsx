'use client';

import { Component, useState, type ComponentType, type ReactNode } from 'react';
import AdminButton from '../AdminButton';
import ErrorState from '../ErrorState';
import Skeleton from '../Skeleton';

/** Box height of every trend chart (09-charts-and-maps.md): set before load, so 0 CLS. */
export const CHART_HEIGHT = 'h-[180px] sm:h-[240px] short:h-[160px]';

/**
 * Holds a `next/dynamic` component and a retry that swaps in a fresh one, so
 * a chunk that failed to download is fetched again (06-states.md "Lazy chunk fails").
 */
export function useRetryableChunk<P>(initial: ComponentType<P>, create: () => ComponentType<P>) {
  const [Chunk, setChunk] = useState<ComponentType<P>>(() => initial);
  return [Chunk, () => setChunk(() => create())] as const;
}

type ChunkBoundaryProps = {
  /** "Couldn't load this chart." */
  title: string;
  onRetry: () => void;
  children: ReactNode;
};

/** Shows `ErrorState size="inline"` with `[Retry]` when the chunk (or the chart in it) throws. */
export class ChunkBoundary extends Component<ChunkBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  retry = () => {
    this.setState({ failed: false });
    this.props.onRetry();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full items-center">
        <ErrorState
          size="inline"
          title={this.props.title}
          reason="Check your connection, then retry."
          action={
            <AdminButton size="sm" onClick={this.retry}>
              Retry
            </AdminButton>
          }
        />
      </div>
    );
  }
}

/** Loading block for a trend chart: same height as the chart, 3 faint y-tick lines. */
export function ChartSkeleton({ label = 'chart' }: { label?: string }) {
  return (
    <div aria-busy="true" className="relative h-full w-full">
      <span className="sr-only">Loading {label}</span>
      <Skeleton shape="block" className="absolute inset-0 opacity-50" />
      {[0, 33.3, 66.6].map((top) => (
        <span key={top} aria-hidden="true" className="absolute inset-x-0 border-t border-edge" style={{ top: `${top}%` }} />
      ))}
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 border-t border-edge" />
    </div>
  );
}
