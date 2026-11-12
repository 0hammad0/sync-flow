'use client';

import { useLinkStatus } from 'next/link';
import LoadingSpinner from '@/shared/components/LoadingSpinner';

/**
 * Pending feedback for a `<Link>` into a chat room. Must be rendered INSIDE
 * the Link (useLinkStatus reads the nearest parent Link).
 *
 * While the navigation is pending it renders a `data-room-link-pending`
 * element, so the card around the link can dim itself with a Tailwind
 * `has-[[data-room-link-pending]]:` variant without lifting state.
 *
 * - `idle` set: swaps that label for spinner + `pendingLabel` (button-style links).
 * - `idle` unset: shows just a spinner (card-style links).
 *
 * The sr-only status region is always mounted so screen readers announce the
 * text change; a live region inserted together with its text often isn't read.
 */
export default function RoomLinkPending({
  idle,
  pendingLabel = 'Opening…',
}: {
  idle?: React.ReactNode;
  pendingLabel?: string;
}) {
  const { pending } = useLinkStatus();

  return (
    <>
      {pending ? (
        <span
          data-room-link-pending=""
          aria-hidden="true"
          className="inline-flex shrink-0 items-center gap-1.5 animate-fade-in"
        >
          <LoadingSpinner size="sm" className="text-brand-text" />
          {idle !== undefined && <span>{pendingLabel}</span>}
        </span>
      ) : (
        idle
      )}
      <span role="status" className="sr-only">
        {pending ? 'Opening room…' : ''}
      </span>
    </>
  );
}
