'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import Sheet from '@/shared/ui/Sheet';
import { formatBytes, formatCountdown, formatNumber, formatTtl, formatUtc, expiryTone } from '@/features/admin/format';
import type { CloseRoomData } from '../actions';
import type { RoomDetailDto } from '../types';
import CloseRoomDialog from './CloseRoomDialog';

type RoomDetailSheetProps = {
  code: string;
  /** null: the room no longer exists. */
  detail: RoomDetailDto | null;
  nowMs: number;
  canClose: boolean;
  canSeeUsers: boolean;
  adminEmail: string | null;
  onOpenChange: (open: boolean) => void;
  onClosed: (data: CloseRoomData) => void;
  onGone: () => void;
};

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-edge py-2 last:border-b-0">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-right text-sm text-fg tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Room detail (`?code=`), metadata only [D-4]: no message text, no file
 * names, no previews and no link into the chat. Right sheet; full width on phones.
 */
export default function RoomDetailSheet({
  code,
  detail,
  nowMs,
  canClose,
  canSeeUsers,
  adminEmail,
  onOpenChange,
  onClosed,
  onGone,
}: RoomDetailSheetProps) {
  const [closeOpen, setCloseOpen] = useState(false);
  const tone = detail ? expiryTone(detail.expiresAt, nowMs) : 'ok';

  return (
    <Sheet open onOpenChange={onOpenChange} side="right" width="440px" title={`Room ${code}`} description={detail?.name ?? undefined}>
      {!detail ? (
        <p role="status" className="py-2 text-sm text-fg-muted">
          This room no longer exists. It expired or was closed.
        </p>
      ) : (
        <div className="flex flex-col">
          <div>
            {tone === 'expired' && (
              <p className="mb-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-text">Expired · waiting for cleanup</p>
            )}
            <dl>
              <Item label="Name">
                <span dir="auto">{detail.name ?? '—'}</span>
              </Item>
              <Item label="Created">{formatUtc(detail.createdAt)}</Item>
              <Item label="Creator time zone">{detail.creatorTz ?? '—'}</Item>
              <Item label="Expires">
                {formatUtc(detail.expiresAt)}
                <span className={`block text-xs ${tone === 'ok' ? 'text-fg-muted' : tone === 'soon' ? 'text-warning-text' : 'text-danger-text'}`}>
                  {formatCountdown(detail.expiresAt, nowMs)}
                </span>
              </Item>
              <Item label="TTL">{formatTtl(detail.ttlHours)}</Item>
              <Item label="Creator">
                {detail.createdBy ? (
                  canSeeUsers ? (
                    <Link className="text-brand-text hover:underline" href={`/admin/users/${detail.createdBy}`}>
                      Signed-in user
                    </Link>
                  ) : (
                    'Signed-in user'
                  )
                ) : (
                  'Guest'
                )}
              </Item>
              <Item label="Online now">{formatNumber(detail.onlineCount)}</Item>
              <Item label="Messages">{formatNumber(detail.messageCount)}</Item>
              <Item label="Voice notes">{formatNumber(detail.voiceCount)}</Item>
              <Item label="Files">{formatNumber(detail.fileCount)}</Item>
              <Item label="Storage">{formatBytes(detail.totalBytes)}</Item>
            </dl>
            <p className="mt-3 text-xs text-fg-muted">
              Counts and sizes only. Message text and files are never shown here. Files include long-text bodies.
            </p>
          </div>
          {canClose && (
            <div className="sticky -bottom-4 -mx-4 mt-4 -mb-4 border-t border-edge bg-surface px-4 py-3">
              <button
                type="button"
                onClick={() => setCloseOpen(true)}
                className="inline-flex h-8 w-full cursor-pointer items-center justify-center rounded-md bg-danger px-3 text-sm font-medium text-on-danger pointer-coarse:h-11 pointer-fine:hover:brightness-95"
              >
                Close room
              </button>
            </div>
          )}
          {closeOpen && (
            <CloseRoomDialog
              open={closeOpen}
              onOpenChange={setCloseOpen}
              room={detail}
              adminEmail={adminEmail}
              onClosed={onClosed}
              onGone={onGone}
            />
          )}
        </div>
      )}
    </Sheet>
  );
}
