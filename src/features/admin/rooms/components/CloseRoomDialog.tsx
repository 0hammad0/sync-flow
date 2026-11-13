'use client';

import { useId, useState } from 'react';
import { blockedError } from '@/shared/lib/blocked';
import ConfirmDialog, { type ConfirmResult } from '@/shared/ui/ConfirmDialog';
import StepUpNotice from '@/features/admin/shell/StepUpNotice';
import { formatBytes, formatNumber } from '@/features/admin/format';
import { closeRoom, type CloseRoomData } from '../actions';
import { REASON_MAX, REASON_MIN } from '../schemas';
import type { RoomRowDto } from '../types';

type CloseRoomDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: Pick<RoomRowDto, 'code' | 'messageCount' | 'fileCount' | 'totalBytes'>;
  adminEmail: string | null;
  onClosed: (data: CloseRoomData) => void;
  /** The room was already gone. */
  onGone: () => void;
};

function consequence(room: CloseRoomDialogProps['room']): string {
  const parts = [`${formatNumber(room.messageCount)} messages`];
  if (room.fileCount != null) parts.push(`${formatNumber(room.fileCount)} files (${formatBytes(room.totalBytes)})`);
  return `This deletes all ${parts.join(' and ')} now. People in the room are removed. This cannot be undone.`;
}

/** 12-rooms.md "Close dialog copy": reason (3–200) + type the code. Step-up shows in place. */
export default function CloseRoomDialog({ open, onOpenChange, room, adminEmail, onClosed, onGone }: CloseRoomDialogProps) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [stepUp, setStepUp] = useState<{ authAgeSec: number | null } | null>(null);

  const confirm = async (): Promise<ConfirmResult> => {
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) return { ok: false, error: 'invalid', message: 'Add a reason (at least 3 characters).' };
    const result = await closeRoom({ code: room.code, reason: trimmed, confirm: room.code }).catch((e: unknown) => ({
      ok: false as const,
      error: 'internal' as const,
      message: blockedError(e) ?? 'Check your connection and try again.',
    }));
    if (result.ok) {
      setStepUp(null);
      onClosed(result.data);
      return { ok: true };
    }
    if (result.error === 'step_up_required') {
      setStepUp({ authAgeSec: result.authAgeSec ?? null });
      return { ok: false, error: result.error, message: 'Sign in again to close this room.' };
    }
    if (result.error === 'not_found') {
      onGone();
      return { ok: true };
    }
    if (result.error === 'blocked') return { ok: false, error: 'blocked', message: blockedError(result) ?? "You can't do this right now." };
    if (result.error === 'forbidden') return { ok: false, error: 'forbidden', message: 'Your role cannot close rooms.' };
    if (result.error === 'invalid') {
      const fields = result.fields ?? {};
      return { ok: false, error: 'invalid', message: fields.reason?.[0] ?? fields.confirm?.[0] ?? 'Check the form and try again.' };
    }
    return {
      ok: false,
      error: result.error,
      message: `Could not close the room. Nothing was confirmed as removed; try again.${'errorId' in result && result.errorId ? ` Error id ${result.errorId}.` : ''}`,
    };
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          setStepUp(null);
        }
        onOpenChange(next);
      }}
      title={`Close room ${room.code}?`}
      consequence={consequence(room)}
      confirmLabel="Close room"
      tone="danger"
      typeToConfirm={room.code}
      onConfirm={confirm}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={reasonId} className="text-sm text-fg">
          Reason
        </label>
        <input
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={REASON_MAX}
          placeholder="Why are you closing it?"
          autoComplete="off"
          className="input-admin h-8 w-full px-2.5 text-base pointer-coarse:h-11 pointer-fine:sm:text-sm"
        />
      </div>
      {stepUp && <StepUpNotice email={adminEmail} authAgeSec={stepUp.authAgeSec} what="Closing a room" />}
    </ConfirmDialog>
  );
}
