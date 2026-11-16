'use client';

import dynamic from 'next/dynamic';
import Skeleton from '@/shared/ui/Skeleton';
import { ChunkBoundary, useRetryableChunk } from '@/shared/ui/charts/lazy-chunk';
import type { MapMode } from '../constants';
import type { ClickPointDto, ClickTargetDto, VwBucket } from '../types';

export type ClickMapProps = {
  path: string;
  vw: VwBucket;
  mode: MapMode;
  points: ClickPointDto[];
  targets: ClickTargetDto[];
};

/** Map placeholder with the bucket's shape, so the lazy chunk causes no layout shift. */
export function ClickMapSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-4 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
      <span className="sr-only">Loading the click map</span>
      <Skeleton shape="block" className="h-[60vh] min-h-80 w-full" />
      <Skeleton shape="block" className="h-64 w-full" />
    </div>
  );
}

const createOverlay = () =>
  dynamic(() => import('./ClickMapOverlay'), { ssr: false, loading: () => <ClickMapSkeleton /> });
const FirstOverlay = createOverlay();

/**
 * The map view's only first-load code: the overlay (iframe, canvas, hover
 * list) is a lazy chunk, fetched only when `view=map` renders this.
 */
export default function ClickMap(props: ClickMapProps) {
  const [Overlay, retry] = useRetryableChunk(FirstOverlay, createOverlay);
  return (
    <ChunkBoundary title="Couldn't load the click map." onRetry={retry}>
      <Overlay {...props} />
    </ChunkBoundary>
  );
}
