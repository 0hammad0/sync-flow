interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /**
   * When set, the spinner announces itself: it is wrapped in a
   * `role="status"` live region with this text for screen readers.
   * Leave it unset inside buttons or regions that already say what's loading.
   */
  label?: string;
}

const SIZE_CLASSES = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-8 w-8',
} as const;

export default function LoadingSpinner({ size = 'md', className = '', label }: LoadingSpinnerProps) {
  const svg = (
    <svg
      className={`animate-spin ${SIZE_CLASSES[size]} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );

  if (!label) return svg;

  return (
    <span role="status" className="inline-flex">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}
