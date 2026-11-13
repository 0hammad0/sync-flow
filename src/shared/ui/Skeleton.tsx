type SkeletonProps = {
  /** Set the exact final width/height here, so loading causes no layout shift. */
  className?: string;
  shape?: 'line' | 'block' | 'circle';
};

const SHAPES = {
  line: 'h-3 rounded-sm',
  block: 'rounded-md',
  circle: 'rounded-full',
} as const;

/**
 * Placeholder that fades in after 200 ms (fast loads never flash it) and is
 * flat under reduced motion. Hidden from screen readers: the container sets
 * aria-busy="true" and one sr-only "Loading {name}".
 */
export default function Skeleton({ className = '', shape = 'line' }: SkeletonProps) {
  return <span aria-hidden="true" className={`skeleton skeleton-delayed block ${SHAPES[shape]} ${className}`} />;
}
