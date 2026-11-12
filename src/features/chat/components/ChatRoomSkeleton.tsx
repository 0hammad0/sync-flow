'use client';

import { useParams } from 'next/navigation';
import { isValidRoomCode } from '@/shared/lib/utils';

// Placeholder bubbles: side + width only, so the skeleton reads as a chat.
const BUBBLES: ReadonlyArray<{ mine: boolean; w: string; tall?: boolean }> = [
  { mine: false, w: 'w-40 sm:w-56' },
  { mine: false, w: 'w-28 sm:w-36' },
  { mine: true, w: 'w-48 sm:w-64', tall: true },
  { mine: false, w: 'w-52 sm:w-72', tall: true },
  { mine: true, w: 'w-24 sm:w-32' },
];

/**
 * Shown while a room page is on its way (route `loading.tsx`) and while the
 * client-only ChatRoom chunk downloads (ChatRoomLoader). Mirrors ChatRoom's
 * fixed panel, header, message list and composer box-for-box so nothing jumps
 * when the real room replaces it. The real room code is read from the URL so
 * the user sees straight away which room is opening.
 */
export default function ChatRoomSkeleton() {
  const params = useParams<{ roomCode?: string }>();
  const raw = typeof params?.roomCode === 'string' ? params.roomCode.toUpperCase() : '';
  const code = isValidRoomCode(raw) ? raw : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 top-[var(--site-header-h,3.75rem)] flex flex-col overflow-hidden bg-canvas"
    >
      <span className="sr-only">{code ? `Opening room ${code}…` : 'Opening room…'}</span>

      <div
        aria-hidden="true"
        className="relative flex flex-col flex-1 min-h-0 w-full max-w-2xl mx-auto bg-surface sm:my-4 sm:border sm:border-edge sm:rounded-3xl sm:shadow-[var(--shadow-card)] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-edge bg-surface-2/80">
          <div className="flex-1 min-w-0">
            <div className="h-5 flex items-center">
              <div className="h-4 w-36 sm:w-44 max-w-full rounded-md skeleton" />
            </div>
            <div className="text-[11px] sm:text-xs mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 leading-4">
              {code ? (
                <span className="font-mono tracking-wider sm:tracking-widest text-brand-text whitespace-nowrap">
                  {code}
                </span>
              ) : (
                <span className="h-3 w-16 rounded skeleton" />
              )}
              <span className="h-3 w-14 rounded skeleton" />
              <span className="h-3 w-24 rounded skeleton" />
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div className="w-[34px] h-[34px] rounded-lg skeleton" />
            <div className="w-[34px] h-[34px] rounded-lg skeleton max-sm:hidden" />
            <div className="w-[34px] h-[34px] rounded-lg skeleton" />
            <div className="w-[34px] h-[34px] rounded-lg skeleton" />
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-hidden px-2 sm:px-4 py-3 sm:py-4 space-y-3 bg-canvas/50">
          {BUBBLES.map((b, i) => (
            <div key={i} className={`flex ${b.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex flex-col gap-1.5 max-w-[85%] ${b.mine ? 'items-end' : 'items-start'}`}>
                {!b.mine && <div className="h-2.5 w-16 rounded skeleton" />}
                <div
                  className={`${b.w} ${b.tall ? 'h-14' : 'h-9'} max-w-full rounded-2xl skeleton ${
                    b.mine ? 'rounded-br-md' : 'rounded-bl-md'
                  }`}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Composer */}
        <div className="border-t border-edge bg-surface px-2 sm:px-4 pt-2.5 sm:pt-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:pb-3 space-y-2">
          <div className="flex items-end gap-1 sm:gap-2 min-w-0">
            <div className="shrink-0 h-10 w-10 sm:h-11 sm:w-11 rounded-xl skeleton" />
            <div className="shrink-0 h-10 w-10 sm:h-11 sm:w-11 rounded-xl skeleton" />
            <div className="input-base flex-1 min-w-0 h-10 sm:h-11 px-3 flex items-center">
              <span className="text-base sm:text-sm text-fg-faint">Message</span>
            </div>
            <div className="shrink-0 h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-surface-3" />
          </div>
          <div className="h-[15px] flex items-center px-1">
            <div className="h-2.5 w-40 rounded skeleton" />
          </div>
        </div>
      </div>
    </div>
  );
}
