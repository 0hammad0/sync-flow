interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * SyncFlow mark — a gradient tile with two flowing waves (data in motion).
 * Inline SVG so it stays crisp at any size and inherits the brand tokens.
 */
export default function Logo({ size = 32, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="SyncFlow"
    >
      <defs>
        <linearGradient id="sf-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--brand, #0c7d6f)" />
          <stop offset="1" stopColor="var(--brand-2, #00c2cb)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#sf-mark)" />
      {/* Two offset waves — "flow" */}
      <path
        d="M7 13.2c3-3.4 6-3.4 9 0s6 3.4 9 0"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M7 20.4c3-3.4 6-3.4 9 0s6 3.4 9 0"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
    </svg>
  );
}
